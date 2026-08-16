import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { EditProgram } from '@reelops/shared';
import { config } from '../config.js';
import { pickVisionProvider } from '../adapters/vision-provider.js';
import { clusterHub, nextClusterOffset, type PeakHit } from './peak-snap.js';
import { recomputePlanDuration, type ReelPlan } from './planner.js';

export const MAX_TAKE_REPLACEMENTS = 2;

export const takeVerdictSchema = z.object({
  action: z.enum(['keep', 'replace', 'fail']),
  subjectInFrame: z.boolean(),
  sameScene: z.boolean(),
  blackFrame: z.boolean(),
  publishable: z.boolean(),
  reason: z.string().trim().min(1).max(160),
});
export type TakeVerdict = z.infer<typeof takeVerdictSchema>;

export const reelPublishVerdictSchema = z.object({
  publishable: z.boolean(),
  reason: z.string().trim().min(1).max(160),
});
export type ReelPublishVerdict = z.infer<typeof reelPublishVerdictSchema>;

export type TakeJudgeAsk = (input: { images: Buffer[]; prompt: string }) => Promise<unknown>;

export function isTakeJudgeConfigured() {
  return (
    pickVisionProvider({
      openaiKey: config.OPENAI_API_KEY,
      geminiKey: config.GEMINI_API_KEY,
      preference: config.VISION_PROVIDER,
    }) !== 'heuristic'
  );
}

export function actionFromVerdict(
  verdict: TakeVerdict,
  replacementsUsed: number,
): 'keep' | 'replace' | 'fail' {
  if (verdict.blackFrame) return 'fail';
  const keep =
    verdict.publishable && verdict.subjectInFrame && verdict.sameScene && verdict.action !== 'fail';
  if (keep) return 'keep';
  if (verdict.action === 'fail') return 'fail';
  if (replacementsUsed >= MAX_TAKE_REPLACEMENTS) return 'fail';
  return 'replace';
}

export function takeJudgePrompt(input: {
  program: EditProgram;
  kind: 'take' | 'reel';
  takeIndex?: number;
  takeCount?: number;
  firstTakeHint?: string;
}) {
  if (input.kind === 'reel') {
    return `You judge THREE JPEG frames from a finished 9:16 restaurant reel (start, middle, end). Program: ${input.program}.
Do not estimate timestamps. Closed questions only.
${programQuestions(input.program)}
Would you publish this reel as-is?
Reply ONLY JSON: {"publishable":true,"reason":"max 160 chars"}`;
  }
  const index = (input.takeIndex ?? 0) + 1;
  const count = input.takeCount ?? 1;
  const first =
    input.takeIndex && input.takeIndex > 0
      ? `First take (reference image if present): ${input.firstTakeHint ?? 'same stage as take 1'}. sameScene must be true only if THIS take is the same place (stage vs dining room).`
      : 'This is take 1. sameScene must be true.';
  return `You judge ONE JPEG of a single planned take. Program: ${input.program}. Take ${index}/${count}.
We already chose the timestamp. Answer yes/no. Do not propose a new time.
${programQuestions(input.program)}
${first}
blackFrame: true if the frame is black, empty, or unusable.
publishable: would you post THIS take in a restaurant reel?
action: keep | replace | fail. replace = try another instant on the SAME peak/subject, not another corner of the capture window.
Reply ONLY JSON: {"action":"keep","subjectInFrame":true,"sameScene":true,"blackFrame":false,"publishable":true,"reason":"max 160 chars"}`;
}

function programQuestions(program: EditProgram) {
  if (program === 'casa') {
    return 'Casa: subjectInFrame = performer/stage in frame, not customer tables. sameScene = same stage as take 1, not a jump to the dining room.';
  }
  if (program === 'oficio') {
    return 'Oficio: subjectInFrame = hands or station visible.';
  }
  if (program === 'assinatura') {
    return 'Assinatura: subjectInFrame = the plated dish is visible.';
  }
  return 'Pulso: subjectInFrame = action in frame, not floor or ceiling.';
}

export async function judgeTakeImages(input: {
  program: EditProgram;
  images: Buffer[];
  takeIndex: number;
  takeCount: number;
  firstTakeHint?: string;
  ask?: TakeJudgeAsk;
}): Promise<TakeVerdict> {
  const raw = await (input.ask ?? defaultAsk)({
    images: input.images,
    prompt: takeJudgePrompt({
      program: input.program,
      kind: 'take',
      takeIndex: input.takeIndex,
      takeCount: input.takeCount,
      firstTakeHint: input.firstTakeHint,
    }),
  });
  return takeVerdictSchema.parse(raw);
}

export async function judgeFinishedReelImages(input: {
  program: EditProgram;
  images: Buffer[];
  ask?: TakeJudgeAsk;
}): Promise<ReelPublishVerdict> {
  const raw = await (input.ask ?? defaultAsk)({
    images: input.images,
    prompt: takeJudgePrompt({ program: input.program, kind: 'reel' }),
  });
  return reelPublishVerdictSchema.parse(raw);
}

export async function refinePlanTakes(input: {
  plan: ReelPlan;
  peaksByCamera: Map<string, PeakHit[]>;
  windows: Map<string, { start: number; duration: number }>;
  dir: string;
  extractFrame: (source: string, atSeconds: number, dest: string) => Promise<unknown>;
  readJpeg?: (file: string) => Promise<Buffer>;
  ask?: TakeJudgeAsk;
}): Promise<ReelPlan> {
  if (!input.ask && !isTakeJudgeConfigured()) return input.plan;
  const readJpeg = input.readJpeg ?? ((file: string) => readFile(file));
  const scenes = [...input.plan.scenes];
  let firstHint: string | undefined;
  let firstJpeg: Buffer | undefined;
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index]!;
    const window = input.windows.get(scene.camera_id) ?? {
      start: scene.source_start_offset,
      duration: Math.max(scene.duration, 8),
    };
    const peaks = input.peaksByCamera.get(scene.camera_id) ?? [];
    const hub = clusterHub({
      windowStart: window.start,
      windowDuration: window.duration,
      takeDuration: scene.duration,
      peaks,
    });
    let replacements = 0;
    let current = scene;
    for (;;) {
      const dest = path.join(input.dir, `take-judge-${index}-${replacements}.jpg`);
      const at = current.source_start_offset + Math.max(0.2, current.duration * 0.5);
      await input.extractFrame(current.source_recording_path, at, dest);
      const jpeg = await readJpeg(dest);
      const images = firstJpeg && index > 0 ? [firstJpeg, jpeg] : [jpeg];
      const verdict = await judgeTakeImages({
        program: input.plan.program,
        images,
        takeIndex: index,
        takeCount: scenes.length,
        firstTakeHint: firstHint,
        ask: input.ask,
      });
      const action = actionFromVerdict(verdict, replacements);
      if (action === 'keep') {
        scenes[index] = current;
        if (index === 0) {
          firstHint = verdict.reason;
          firstJpeg = jpeg;
        }
        break;
      }
      if (action === 'fail') {
        throw new Error(`TAKE_JUDGE_FAILED:${verdict.reason}`);
      }
      const nextStart = nextClusterOffset({
        windowStart: window.start,
        windowDuration: window.duration,
        takeDuration: current.duration,
        usedOffsets: [
          ...scenes
            .filter((_, sceneIndex) => sceneIndex !== index)
            .map((row) => row.source_start_offset),
          current.source_start_offset,
        ],
        peaks,
        hub,
      });
      if (nextStart == null) throw new Error(`TAKE_JUDGE_FAILED:${verdict.reason}`);
      replacements += 1;
      current = { ...current, source_start_offset: nextStart };
    }
  }
  return recomputePlanDuration({ ...input.plan, scenes });
}

export async function judgeFinishedMp4(input: {
  program: EditProgram;
  mp4: string;
  durationSeconds: number;
  dir: string;
  extractFrame: (source: string, atSeconds: number, dest: string) => Promise<unknown>;
  readJpeg?: (file: string) => Promise<Buffer>;
  ask?: TakeJudgeAsk;
}): Promise<ReelPublishVerdict> {
  if (!input.ask && !isTakeJudgeConfigured()) {
    return { publishable: true, reason: 'take-judge skipped' };
  }
  const readJpeg = input.readJpeg ?? ((file: string) => readFile(file));
  const duration = Math.max(1, input.durationSeconds);
  const stamps = [0.35, duration / 2, Math.max(0.4, duration - 0.45)];
  const images: Buffer[] = [];
  for (const [index, at] of stamps.entries()) {
    const dest = path.join(input.dir, `reel-judge-${index}.jpg`);
    await input.extractFrame(input.mp4, at, dest);
    images.push(await readJpeg(dest));
  }
  const verdict = await judgeFinishedReelImages({
    program: input.program,
    images,
    ask: input.ask,
  });
  if (!verdict.publishable) throw new Error(`TAKE_JUDGE_FAILED:${verdict.reason}`);
  return verdict;
}

function stripJsonFence(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

async function defaultAsk(input: { images: Buffer[]; prompt: string }): Promise<unknown> {
  const kind = pickVisionProvider({
    openaiKey: config.OPENAI_API_KEY,
    geminiKey: config.GEMINI_API_KEY,
    preference: config.VISION_PROVIDER,
  });
  if (kind === 'heuristic') throw new Error('VISION_PROVIDER_NOT_CONFIGURED');
  try {
    if (kind === 'openai') return await askOpenAI(input);
    return await askGemini(input);
  } catch (error) {
    const secondary = config.VISION_PROVIDER_SECONDARY;
    if (secondary === 'gemini' && config.GEMINI_API_KEY && kind !== 'gemini') {
      return askGemini(input);
    }
    if (secondary === 'openai' && config.OPENAI_API_KEY && kind !== 'openai') {
      return askOpenAI(input);
    }
    throw error;
  }
}

async function askOpenAI(input: { images: Buffer[]; prompt: string }) {
  if (!config.OPENAI_API_KEY) throw new Error('VISION_PROVIDER_NOT_CONFIGURED');
  const content: Array<Record<string, unknown>> = input.images.map((bytes) => ({
    type: 'image_url',
    image_url: {
      url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      detail: 'low',
    },
  }));
  content.push({ type: 'text', text: input.prompt });
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      temperature: 0,
      max_tokens: 220,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    }),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) {
    const message = payload.error?.message ?? `OPENAI_HTTP_${response.status}`;
    if (
      /invalid_api_key|incorrect api key|insufficient_quota|OPENAI_HTTP_401|OPENAI_HTTP_403/i.test(
        message,
      )
    ) {
      throw new Error('OPENAI_API_BLOCKED');
    }
    throw new Error(message);
  }
  const text = payload.choices?.[0]?.message?.content ?? '';
  return JSON.parse(stripJsonFence(text)) as unknown;
}

async function askGemini(input: { images: Buffer[]; prompt: string }) {
  if (!config.GEMINI_API_KEY) throw new Error('VISION_PROVIDER_NOT_CONFIGURED');
  const { GoogleGenAI, createUserContent } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const parts: Array<Record<string, unknown>> = input.images.map((bytes) => ({
    inlineData: { mimeType: 'image/jpeg', data: bytes.toString('base64') },
  }));
  parts.push({ text: input.prompt });
  const response = await ai.models.generateContent({
    model: config.GEMINI_MODEL,
    contents: createUserContent(parts as never),
    config: { responseMimeType: 'application/json', temperature: 0 },
  });
  return JSON.parse(stripJsonFence(response.text ?? '')) as unknown;
}
