import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { EditProgram } from '@reelops/shared';
import { config } from '../config.js';
import { pickVisionProvider } from '../adapters/vision-provider.js';
import { EDITORIAL, type HardRejectCode } from './editorial-thresholds.js';
import { clusterHub, nextClusterOffset, type PeakHit } from './peak-snap.js';
import { recomputePlanDuration, type ReelPlan } from './planner.js';

export const MAX_TAKE_REPLACEMENTS = EDITORIAL.maxTakeReplacements;

export const takeVerdictSchema = z.object({
  action: z.enum(['keep', 'replace', 'fail']),
  subjectInFrame: z.boolean(),
  sameScene: z.boolean(),
  blackFrame: z.boolean(),
  publishable: z.boolean(),
  visualQuality: z.number().min(0).max(100).optional(),
  contentRelevance: z.number().min(0).max(100).optional(),
  hardReject: z.boolean().optional(),
  rejectCode: z
    .enum(['none', 'black', 'wrong_scene', 'no_subject', 'watermark', 'unusable'])
    .optional(),
  customersOnly: z.boolean().optional(),
  reason: z.string().trim().min(1).max(160),
});
export type TakeVerdict = z.infer<typeof takeVerdictSchema>;

export type TakeJudgeDecision = 'ACCEPT' | 'REJECT' | 'CONDITIONAL';

export type TakeJudgeReport = {
  takeIndex: number;
  cameraId: string;
  sourceIn: number;
  sourceOut: number;
  frames: number[];
  visualQuality: number;
  contentRelevance: number;
  subjectInFrame: boolean;
  sameScene: boolean;
  hardReject: boolean;
  rejectCode: HardRejectCode;
  decision: TakeJudgeDecision;
  action: 'keep' | 'replace' | 'fail';
  replacements: number;
  reason: string;
  hookScore?: number;
  customersOnly?: boolean;
};

export const reelPublishVerdictSchema = z.object({
  publishable: z.boolean(),
  hookOk: z.boolean().optional(),
  wrongScene: z.boolean().optional(),
  copySafe: z.boolean().optional(),
  reason: z.string().trim().min(1).max(160),
});
export type ReelPublishVerdict = z.infer<typeof reelPublishVerdictSchema>;

export type TakeJudgeAsk = (input: { images: Buffer[]; prompt: string }) => Promise<unknown>;

export class TakeJudgeError extends Error {
  readonly reports: TakeJudgeReport[];
  constructor(reason: string, reports: TakeJudgeReport[] = []) {
    super(`TAKE_JUDGE_FAILED:${reason}`);
    this.name = 'TakeJudgeError';
    this.reports = reports;
  }
}

export type HubScoutReport = {
  cameraId: string;
  hub: number;
  visualQuality: number;
  contentRelevance: number;
  subjectInFrame: boolean;
  customersOnly: boolean;
  hardReject: boolean;
  reason: string;
};

export function customersOnlyFromVerdict(verdict: TakeVerdict): boolean {
  if (verdict.customersOnly === true) return true;
  const text = verdict.reason.toLowerCase();
  const noShow =
    /no (clear )?(performer|stage)|without (a )?(performer|stage)|only seated|only customer|sem palco|sem cantor/i.test(
      text,
    );
  const dining = /(customer|dining|tables?|mesa|seated|dining room|\bcrowd\b)/i.test(text);
  const stagePositive =
    /(on stage|stage view|performer visible|singer|band|palco|cantor|instrument)/i.test(text) &&
    !noShow;
  if (noShow || (dining && !stagePositive)) return true;
  if (verdict.customersOnly === false) return false;
  return false;
}

export function isUnusableHardReject(verdict: TakeVerdict): boolean {
  const code = verdict.rejectCode ?? (verdict.blackFrame ? 'black' : 'none');
  return (
    verdict.blackFrame === true || code === 'black' || code === 'watermark' || code === 'unusable'
  );
}

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
  const customersOnly = customersOnlyFromVerdict(verdict);
  const visual = verdict.visualQuality ?? (verdict.publishable ? 70 : 40);
  const relevance = customersOnly
    ? Math.min(verdict.contentRelevance ?? 18, EDITORIAL.prettyButWrongRelevance - 1)
    : (verdict.contentRelevance ??
      (verdict.subjectInFrame && verdict.publishable && verdict.sameScene ? 80 : 20));
  if (isUnusableHardReject(verdict)) return 'fail';
  const prettyButWrong =
    customersOnly || (visual >= 70 && relevance < EDITORIAL.prettyButWrongRelevance);
  const keep =
    verdict.publishable &&
    verdict.subjectInFrame &&
    verdict.sameScene &&
    verdict.action !== 'fail' &&
    !customersOnly &&
    relevance >= EDITORIAL.minContentRelevance &&
    visual >= EDITORIAL.minVisualQuality &&
    !prettyButWrong;
  if (keep) return 'keep';
  if (
    customersOnly ||
    verdict.rejectCode === 'wrong_scene' ||
    verdict.rejectCode === 'no_subject'
  ) {
    if (replacementsUsed >= MAX_TAKE_REPLACEMENTS) return 'fail';
    return 'replace';
  }
  if (verdict.action === 'fail') return 'fail';
  if (replacementsUsed >= MAX_TAKE_REPLACEMENTS) return 'fail';
  return 'replace';
}

export function decisionLabel(action: 'keep' | 'replace' | 'fail'): TakeJudgeDecision {
  if (action === 'keep') return 'ACCEPT';
  if (action === 'fail') return 'REJECT';
  return 'CONDITIONAL';
}

export function hookScore(
  visualQuality: number,
  contentRelevance: number,
  subjectInFrame: boolean,
) {
  return Math.round(visualQuality * 0.3 + contentRelevance * 0.5 + (subjectInFrame ? 20 : 0));
}

export function eligibleScoutHubs(reports: HubScoutReport[]): HubScoutReport[] {
  return reports
    .filter(
      (row) =>
        !row.hardReject &&
        !row.customersOnly &&
        row.subjectInFrame &&
        row.contentRelevance >= EDITORIAL.minContentRelevance,
    )
    .sort(
      (left, right) =>
        right.contentRelevance - left.contentRelevance || right.visualQuality - left.visualQuality,
    );
}

export function pickScoutedHub(reports: HubScoutReport[]): HubScoutReport | null {
  return eligibleScoutHubs(reports)[0] ?? null;
}

export async function scoutClusterHubs(input: {
  program: EditProgram;
  cameraId: string;
  sourcePath: string;
  hubs: number[];
  dir: string;
  extractFrame: (source: string, atSeconds: number, dest: string) => Promise<unknown>;
  readJpeg?: (file: string) => Promise<Buffer>;
  ask?: TakeJudgeAsk;
}): Promise<HubScoutReport[]> {
  if (!input.ask && !isTakeJudgeConfigured()) return [];
  const readJpeg = input.readJpeg ?? ((file: string) => readFile(file));
  const reports: HubScoutReport[] = [];
  for (const [index, hub] of input.hubs.entries()) {
    const at = Math.max(0, hub + 0.6);
    const dest = path.join(input.dir, `hub-scout-${input.cameraId}-${index}.jpg`);
    await input.extractFrame(input.sourcePath, at, dest);
    const jpeg = await readJpeg(dest);
    const verdict = await judgeTakeImages({
      program: input.program,
      images: [jpeg],
      takeIndex: 0,
      takeCount: 1,
      ask: input.ask,
    });
    const visual = verdict.visualQuality ?? (verdict.publishable ? 70 : 40);
    const customersOnly = customersOnlyFromVerdict(verdict);
    const relevance = customersOnly
      ? Math.min(verdict.contentRelevance ?? 18, EDITORIAL.prettyButWrongRelevance - 1)
      : (verdict.contentRelevance ?? (verdict.subjectInFrame && verdict.publishable ? 80 : 18));
    const code = verdict.rejectCode ?? (verdict.blackFrame ? 'black' : 'none');
    reports.push({
      cameraId: input.cameraId,
      hub,
      visualQuality: visual,
      contentRelevance: relevance,
      subjectInFrame: customersOnly ? false : verdict.subjectInFrame,
      customersOnly,
      hardReject:
        verdict.blackFrame ||
        verdict.hardReject === true ||
        code === 'black' ||
        code === 'watermark' ||
        code === 'unusable',
      reason: verdict.reason,
    });
  }
  return reports;
}

export function takeJudgePrompt(input: {
  program: EditProgram;
  kind: 'take' | 'reel';
  takeIndex?: number;
  takeCount?: number;
  firstTakeHint?: string;
}) {
  if (input.kind === 'reel') {
    return `You judge THREE JPEG frames from a finished 9:16 Casa/live-show reel (start, middle, end). Program: ${input.program}.
Do not estimate timestamps. Closed questions only.
${programQuestions(input.program)}
visualQuality = how sharp/lit the frames are (0-100). contentRelevance = match to the LIVE SHOW (performer/stage), never "nice restaurant". A pretty dining room is high visualQuality and low contentRelevance.
wrongScene = true if any frame is mainly customer tables without the show.
Would you publish this as a live-show reel?
Reply ONLY JSON: {"publishable":true,"hookOk":true,"wrongScene":false,"copySafe":true,"reason":"max 160 chars"}`;
  }
  const index = (input.takeIndex ?? 0) + 1;
  const count = input.takeCount ?? 1;
  const first =
    input.takeIndex && input.takeIndex > 0
      ? `First take (reference image if present): ${input.firstTakeHint ?? 'same stage as take 1'}. sameScene must be true only if THIS take is the same place (stage vs dining room).`
      : 'This is take 1. sameScene must be true.';
  return `You judge JPEG(s) of ONE planned take. Program: ${input.program}. Take ${index}/${count}.
We already chose the timestamp. Answer yes/no. Do not propose a new time.
${programQuestions(input.program)}
${first}
blackFrame: true if any frame is black, empty, or unusable.
visualQuality: 0-100 technical look.
contentRelevance: 0-100 match to the LIVE SHOW subject. Customer tables without a performer MUST be 0-25 even if beautiful.
customersOnly: true if the picture is mainly seated customers, tables, bar, or dining room and there is no performer/stage. If customersOnly is true, subjectInFrame MUST be false and contentRelevance MUST be 0-25.
hardReject: true only for black, watermark, or unusable. wrong_scene / no_subject should replace, not hardReject, unless every instant on this peak is wrong.
publishable: would you post THIS take in a live-show Casa reel? Dining-room-only is not publishable.
action: keep | replace | fail. replace = try another instant on the SAME peak/subject, not another corner of the capture window.
Reply ONLY JSON: {"action":"keep","subjectInFrame":true,"sameScene":true,"blackFrame":false,"publishable":true,"visualQuality":80,"contentRelevance":80,"customersOnly":false,"hardReject":false,"rejectCode":"none","reason":"max 160 chars"}`;
}

function programQuestions(program: EditProgram) {
  if (program === 'casa') {
    return 'Casa is a LIVE SHOW reel. subjectInFrame = a performer, instrument, or stage is clearly visible. customersOnly = seated diners/tables/bar with no performer. Dining room is the wrong scene even if it is a restaurant.';
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
  hubByCamera?: Map<string, number>;
  hubsByCamera?: Map<string, number[]>;
}): Promise<{ plan: ReelPlan; reports: TakeJudgeReport[] }> {
  if (!input.ask && !isTakeJudgeConfigured()) {
    return { plan: input.plan, reports: [] };
  }
  const readJpeg = input.readJpeg ?? ((file: string) => readFile(file));
  const planned = [...input.plan.scenes];
  const kept: ReelPlan['scenes'] = [];
  const reports: TakeJudgeReport[] = [];
  const rejectedStarts = new Set<string>();
  let firstHint: string | undefined;
  let firstJpeg: Buffer | undefined;
  for (let index = 0; index < planned.length; index += 1) {
    const scene = planned[index]!;
    const window = input.windows.get(scene.camera_id) ?? {
      start: scene.source_start_offset,
      duration: Math.max(scene.duration, 8),
    };
    const peaks = input.peaksByCamera.get(scene.camera_id) ?? [];
    const scoutedHubs = input.hubsByCamera?.get(scene.camera_id) ?? [];
    const hub =
      input.hubByCamera?.get(scene.camera_id) ??
      scoutedHubs[0] ??
      clusterHub({
        windowStart: window.start,
        windowDuration: window.duration,
        takeDuration: scene.duration,
        peaks,
      });
    let replacements = 0;
    let current = scene;
    for (;;) {
      const stamps = EDITORIAL.takeSampleFractions.map(
        (fraction) => current.source_start_offset + Math.max(0.15, current.duration * fraction),
      );
      const jpegs: Buffer[] = [];
      for (const [frameIndex, at] of stamps.entries()) {
        const dest = path.join(input.dir, `take-judge-${index}-${replacements}-${frameIndex}.jpg`);
        await input.extractFrame(current.source_recording_path, at, dest);
        jpegs.push(await readJpeg(dest));
      }
      const images = firstJpeg && kept.length > 0 ? [firstJpeg, ...jpegs] : jpegs;
      const verdict = await judgeTakeImages({
        program: input.plan.program,
        images,
        takeIndex: kept.length,
        takeCount: planned.length,
        firstTakeHint: firstHint,
        ask: input.ask,
      });
      const customersOnly = customersOnlyFromVerdict(verdict);
      const visual = verdict.visualQuality ?? (verdict.publishable ? 70 : 40);
      const relevance = customersOnly
        ? Math.min(verdict.contentRelevance ?? 18, EDITORIAL.prettyButWrongRelevance - 1)
        : (verdict.contentRelevance ?? (verdict.subjectInFrame && verdict.publishable ? 80 : 18));
      const hook =
        kept.length === 0 ? hookScore(visual, relevance, verdict.subjectInFrame) : undefined;
      let action = actionFromVerdict(verdict, replacements);
      if (kept.length === 0 && action === 'keep' && (hook ?? 0) < EDITORIAL.minHookScore) {
        action = replacements >= MAX_TAKE_REPLACEMENTS ? 'fail' : 'replace';
      }
      const report: TakeJudgeReport = {
        takeIndex: kept.length,
        cameraId: current.camera_id,
        sourceIn: current.source_start_offset,
        sourceOut: current.source_start_offset + current.duration,
        frames: stamps.map((value) => Number(value.toFixed(2))),
        visualQuality: visual,
        contentRelevance: relevance,
        subjectInFrame: customersOnly ? false : verdict.subjectInFrame,
        sameScene: verdict.sameScene,
        hardReject: isUnusableHardReject(verdict),
        rejectCode: (verdict.rejectCode ??
          (verdict.blackFrame ? 'black' : 'none')) as HardRejectCode,
        decision: decisionLabel(action),
        action,
        replacements,
        reason: verdict.reason,
        hookScore: hook,
        customersOnly,
      };
      if (action === 'keep') {
        kept.push(current);
        reports.push(report);
        if (kept.length === 1) {
          firstHint = verdict.reason;
          firstJpeg = jpegs[1] ?? jpegs[0];
        }
        break;
      }
      rejectedStarts.add(current.source_start_offset.toFixed(2));
      const nextStart = nextClusterOffset({
        windowStart: window.start,
        windowDuration: window.duration,
        takeDuration: current.duration,
        usedOffsets: [
          ...kept.map((row) => row.source_start_offset),
          current.source_start_offset,
          ...[...rejectedStarts].map((value) => Number(value)),
        ],
        peaks,
        hub,
        hubs: scoutedHubs.length ? scoutedHubs : [hub],
      });
      reports.push(report);
      const exhausted =
        action === 'fail' || nextStart == null || rejectedStarts.has(nextStart.toFixed(2));
      if (exhausted) {
        if (kept.length === 0) {
          reports.push({ ...report, action: 'fail', decision: 'REJECT', hardReject: true });
          throw new TakeJudgeError(verdict.reason, reports);
        }
        break;
      }
      replacements += 1;
      current = { ...current, source_start_offset: nextStart };
    }
  }
  return { plan: recomputePlanDuration({ ...input.plan, scenes: kept }), reports };
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
  const stamps = EDITORIAL.reelSampleFractions.map((fraction) =>
    Math.max(0.2, Math.min(duration - 0.2, duration * fraction)),
  );
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
  if (!verdict.publishable || verdict.wrongScene) {
    throw new TakeJudgeError(verdict.reason);
  }
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
