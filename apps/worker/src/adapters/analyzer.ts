import { geminiHighlightSchema, type CameraRole, type GeminiHighlight } from '@reelops/shared';
import { log } from '../services.js';
import { config } from '../config.js';
import type { StyleName } from '../engine/rhythm.js';
import {
  isHiddenBugFallback,
  isTransientProviderError,
  pickVisionProvider,
  type VisionKind,
} from './vision-provider.js';
import { runtimeStatus } from '../runtime-status.js';

export type ClipCandidate = {
  cameraId: string;
  recordingId?: string;
  path: string;
  localPath: string;
  position: number;
  startOffsetSeconds: number;
  windowDurationSeconds?: number;
  hasAudio: boolean;
  role?: CameraRole;
};

export type PlannedScene = {
  cameraId: string;
  position: number;
  startOffsetSeconds: number;
  durationSeconds: number;
  reason: string;
};

export type EditDecision = {
  clips: ClipCandidate[];
  score: number;
  reason: string;
  detailedScores: {
    food: number;
    action: number;
    visual: number;
    marketing: number;
    ambience: number;
  };
  scenes: PlannedScene[];
  captionPt: string;
  hashtags: string[];
  provider: VisionKind;
  model?: string;
  peopleScore?: number;
  storyScore?: number;
  confidence?: number;
  privacyRisk?: string;
  recommendedUse?: string;
  cameraRankings?: GeminiHighlight['cameraRankings'];
  bestFrames?: GeminiHighlight['bestFrames'];
  framesAnalyzed?: number;
};

export interface SceneAnalyzer {
  analyze(clips: ClipCandidate[]): Promise<EditDecision>;
}

export type VisionFrame = {
  cameraPosition: number;
  path: string;
};

export class HeuristicAnalyzer implements SceneAnalyzer {
  constructor(private readonly style: StyleName) {}

  async analyze(clips: ClipCandidate[]): Promise<EditDecision> {
    const ordered = [...clips].sort((a, b) => a.position - b.position);
    const food = Math.min(88, 58 + ordered.length * 6);
    const action = Math.min(86, 52 + ordered.length * 7);
    const visual = Math.min(90, 70 + ordered.length * 3);
    const detailedScores = {
      food,
      action,
      visual,
      marketing: Math.round((food + action) / 2),
      ambience: Math.min(84, 62 + ordered.length * 4),
    };
    const beat = this.style === 'dynamic' ? 1.8 : this.style === 'cinematic' ? 5 : 3.2;
    const scenes: PlannedScene[] = ordered.map((clip, index) => ({
      cameraId: clip.cameraId,
      position: clip.position,
      startOffsetSeconds: Number((index * 0.4).toFixed(3)),
      durationSeconds: beat,
      reason:
        clip.position === 1 ? 'Balcão / serviço' : clip.position === 3 ? 'Preparo' : 'Ambiente',
    }));
    return {
      clips: ordered,
      score: Math.round(
        (detailedScores.food +
          detailedScores.action +
          detailedScores.visual +
          detailedScores.marketing +
          detailedScores.ambience) /
          5,
      ),
      reason:
        this.style === 'dynamic'
          ? 'Cortes curtos a partir de picos locais de cena e áudio'
          : this.style === 'cinematic'
            ? 'Planos mais longos no melhor ângulo disponível'
            : 'Alternância equilibrada entre as câmeras sincronizadas',
      detailedScores,
      scenes,
      captionPt: '',
      hashtags: [],
      provider: 'heuristic',
    };
  }
}

export class GeminiVisionProvider implements SceneAnalyzer {
  constructor(
    private readonly style: StyleName,
    private readonly options: {
      clipPath?: string;
      framePaths?: VisionFrame[];
      prompt?: string;
      fallback?: SceneAnalyzer;
    },
  ) {}

  async analyze(clips: ClipCandidate[]): Promise<EditDecision> {
    if (!config.GEMINI_API_KEY) {
      if (config.REQUIRE_REAL_VISION || !this.options.fallback)
        throw new Error('VISION_PROVIDER_NOT_CONFIGURED');
      return this.options.fallback.analyze(clips);
    }
    log.info(
      {
        provider: 'gemini',
        model: config.GEMINI_MODEL,
        frames: this.options.framePaths?.length ?? 0,
      },
      'Vision provider: gemini',
    );
    try {
      if (this.options.framePaths?.length) {
        const parsed = await analyzeMomentFrames({
          frames: this.options.framePaths,
          style: this.style,
          prompt: this.options.prompt,
          cameras: clips.map((clip) => clip.position),
        });
        return decisionFromVision(
          clips,
          parsed,
          this.style,
          this.options.framePaths.length,
          'gemini',
          config.GEMINI_MODEL,
        );
      }
      if (!this.options.clipPath) {
        if (config.REQUIRE_REAL_VISION || !this.options.fallback)
          throw new Error('VISION_PROVIDER_NOT_CONFIGURED');
        return this.options.fallback.analyze(clips);
      }
      const parsed = await analyzeHighlightClip({
        clipPath: this.options.clipPath,
        style: this.style,
        prompt: this.options.prompt,
        cameras: clips.map((clip) => clip.position),
      });
      return decisionFromVision(clips, parsed, this.style, 0, 'gemini', config.GEMINI_MODEL);
    } catch (error) {
      const wrapped = geminiFailure(error);
      if (isHiddenBugFallback(wrapped.message)) throw wrapped;
      const realFallback =
        this.options.fallback && !(this.options.fallback instanceof HeuristicAnalyzer);
      if (wrapped.message === 'GEMINI_API_BLOCKED' && realFallback) {
        runtimeStatus.geminiBlocked = true;
        log.warn(
          { err: wrapped.message, provider: 'openai', fallback_reason: 'PROVIDER_BLOCKED' },
          'gemini blocked; switching to configured real fallback',
        );
        return this.options.fallback!.analyze(clips);
      }
      if (realFallback && isTransientProviderError(wrapped.message)) {
        log.warn(
          {
            err: wrapped.message,
            provider_requested: 'gemini',
            fallback_reason: wrapped.message.split(':')[0],
          },
          'gemini transient; switching to configured real fallback',
        );
        return this.options.fallback!.analyze(clips);
      }
      if (config.REQUIRE_REAL_VISION || !this.options.fallback) throw wrapped;
      log.warn({ err: wrapped.message }, 'gemini analysis failed; using local heuristic');
      return this.options.fallback.analyze(clips);
    }
  }
}

export async function analyzeMomentFrames(input: {
  frames: VisionFrame[];
  style: StyleName;
  prompt?: string;
  cameras: number[];
}): Promise<GeminiHighlight> {
  const { GoogleGenAI, createUserContent } = await import('@google/genai');
  const { readFile } = await import('node:fs/promises');
  const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const parts: Array<Record<string, unknown>> = [];
  const selected = input.frames.slice(0, 24);
  log.info(
    { provider: 'gemini', model: config.GEMINI_MODEL, frames: selected.length },
    'Vision provider: gemini',
  );
  for (const frame of selected) {
    const bytes = await readFile(frame.path);
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: bytes.toString('base64') } });
    parts.push({ text: `C${frame.cameraPosition}` });
  }
  parts.push({ text: buildFramePrompt(input.style, input.cameras, input.prompt) });
  const response = await ai.models.generateContent({
    model: config.GEMINI_MODEL,
    contents: createUserContent(parts as never),
    config: { responseMimeType: 'application/json', temperature: 0.2 },
  });
  const text = response.text ?? '';
  return geminiHighlightSchema.parse(JSON.parse(stripJsonFence(text)));
}

function buildFramePrompt(style: StyleName, cameras: number[], extra?: string) {
  return `Você classifica frames JPEG de até 4 câmeras. Elas podem NÃO ser o mesmo lugar nem a mesma ação.
Não monte a timeline. Não identifique clientes. Não invente culinária, cidade ou marca.
Para cada câmera descreva o que realmente aparece: local, ação, comida, pessoas, iluminação, blur, watermark ou marca de terceiro (ex.: canal de TV, outro restaurante).
Role da câmera (master/side/food/ambience) é só um rótulo técnico — ignore se a imagem não corresponder.
Se as câmeras mostrarem cozinhas, pratos ou lugares diferentes, diga isso na reason. Não force coerência.
Câmeras: ${cameras.map((position) => `C${position}`).join(', ')}.
Estilo: ${style}.
${extra ? `Diretriz: ${extra}` : ''}
camera_rankings MUST include exactly one object per listed camera. Each reason describes THAT camera only.
Responda SOMENTE JSON:
{"score":0-100,"reason":"texto","detailedScores":{"food":0-100,"action":0-100,"visual":0-100,"marketing":0-100,"ambience":0-100},"food_score":0-100,"action_score":0-100,"visual_score":0-100,"marketing_score":0-100,"ambience_score":0-100,"people_score":0-100,"story_score":0-100,"confidence":0-100,"description":"texto","privacy_risk":"baixo","recommended_use":"reel","camera_rankings":[{"cameraPosition":1,"score":88,"reason":"C1: descreva só esta câmera."},{"cameraPosition":2,"score":40,"reason":"C2: descreva só esta câmera."},{"cameraPosition":3,"score":55,"reason":"C3: descreva só esta câmera."},{"cameraPosition":4,"score":20,"reason":"C4: descreva só esta câmera."}],"best_frames":[{"cameraPosition":1,"offsetSeconds":8,"reason":"melhor frame visível"}],"scenes":[{"cameraPosition":1,"startOffsetSeconds":2,"durationSeconds":3,"reason":"classificação"}],"captionPt":"","hashtags":[]}`;
}

export async function analyzeHighlightClip(input: {
  clipPath: string;
  style: StyleName;
  prompt?: string;
  cameras: number[];
}): Promise<GeminiHighlight> {
  const { GoogleGenAI, createUserContent } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const uploaded = await ai.files.upload({
    file: input.clipPath,
    config: { mimeType: 'video/mp4' },
  });
  const fileName = uploaded.name;
  try {
    let file = uploaded;
    const deadline = Date.now() + 90_000;
    while (file.state && String(file.state).toUpperCase() !== 'ACTIVE') {
      if (Date.now() > deadline) throw new Error('GEMINI_FILE_TIMEOUT');
      if (String(file.state).toUpperCase() === 'FAILED') throw new Error('GEMINI_FILE_FAILED');
      await sleep(2_000);
      if (!fileName) throw new Error('GEMINI_FILE_NAME');
      file = await ai.files.get({ name: fileName });
    }
    const response = await ai.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: createUserContent([
        {
          fileData: { fileUri: file.uri, mimeType: file.mimeType ?? 'video/mp4' },
          videoMetadata: { startOffset: '0s', endOffset: '12s' },
        },
        buildPrompt(input.style, input.cameras, input.prompt),
      ]),
      config: { responseMimeType: 'application/json', temperature: 0.2 },
    });
    const text = response.text ?? '';
    return geminiHighlightSchema.parse(JSON.parse(stripJsonFence(text)));
  } finally {
    if (fileName) await ai.files.delete({ name: fileName }).catch(() => undefined);
  }
}

export function decisionFromGemini(
  clips: ClipCandidate[],
  parsed: GeminiHighlight,
  style: StyleName,
  framesAnalyzed = 0,
): EditDecision {
  return decisionFromVision(clips, parsed, style, framesAnalyzed, 'gemini', config.GEMINI_MODEL);
}

export function decisionFromVision(
  clips: ClipCandidate[],
  parsed: GeminiHighlight,
  style: StyleName,
  framesAnalyzed = 0,
  provider: VisionKind = 'gemini',
  model?: string,
): EditDecision {
  const byPosition = new Map(clips.map((clip) => [clip.position, clip]));
  const scenes = parsed.scenes.flatMap((scene) => {
    const clip = byPosition.get(scene.cameraPosition) ?? clips[0];
    if (!clip) return [];
    return [
      {
        cameraId: clip.cameraId,
        position: clip.position,
        startOffsetSeconds: scene.startOffsetSeconds,
        durationSeconds: scene.durationSeconds,
        reason: scene.reason,
      },
    ];
  });
  return {
    clips,
    score: parsed.score,
    reason: parsed.reason || `Estilo ${style}`,
    detailedScores: parsed.detailedScores,
    scenes: scenes.length
      ? scenes
      : clips.map((clip) => ({
          cameraId: clip.cameraId,
          position: clip.position,
          startOffsetSeconds: 0,
          durationSeconds: style === 'dynamic' ? 1.8 : style === 'cinematic' ? 5 : 3.2,
          reason: 'Seleção da IA',
        })),
    captionPt: parsed.captionPt ?? '',
    hashtags: parsed.hashtags ?? [],
    provider,
    model,
    peopleScore: parsed.peopleScore,
    storyScore: parsed.storyScore,
    confidence: parsed.confidence,
    privacyRisk: parsed.privacyRisk,
    recommendedUse: parsed.recommendedUse,
    cameraRankings: parsed.cameraRankings,
    bestFrames: parsed.bestFrames,
    framesAnalyzed,
  };
}

function buildPrompt(style: StyleName, cameras: number[], extra?: string) {
  return `Você analisa um clipe curto de câmera de restaurante para um Reel 9:16.
As câmeras podem não ser o mesmo lugar. Não invente culinária, cidade ou marca. Não identifique clientes.
Se houver watermark ou outro estabelecimento, diga isso.
Estilo: ${style}. Câmeras: ${cameras.map((position) => `C${position}`).join(', ') || 'C1'}.
${extra ? `Diretriz: ${extra}` : ''}
Responda SOMENTE JSON:
{"score":0-100,"reason":"texto curto","detailedScores":{"food":0-100,"action":0-100,"visual":0-100,"marketing":0-100,"ambience":0-100},"scenes":[{"cameraPosition":1,"startOffsetSeconds":0,"durationSeconds":2.5,"reason":"por que este corte"}],"captionPt":"","hashtags":[]}`;
}

function stripJsonFence(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function geminiFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /API_KEY_SERVICE_BLOCKED/i.test(message) ||
    (/PERMISSION_DENIED/i.test(message) && /generativelanguage/i.test(message))
  ) {
    return new Error('GEMINI_API_BLOCKED');
  }
  return error instanceof Error ? error : new Error(message);
}

export function configuredVisionKind(): VisionKind {
  return pickVisionProvider({
    openaiKey: config.OPENAI_API_KEY,
    geminiKey: config.GEMINI_API_KEY,
    preference: config.VISION_PROVIDER,
  });
}

export class OpenAIVisionProvider implements SceneAnalyzer {
  constructor(
    private readonly style: StyleName,
    private readonly options: {
      framePaths?: VisionFrame[];
      prompt?: string;
      fallback?: SceneAnalyzer;
    },
  ) {}

  async analyze(clips: ClipCandidate[]): Promise<EditDecision> {
    if (!config.OPENAI_API_KEY || !this.options.framePaths?.length) {
      if (config.REQUIRE_REAL_VISION || !this.options.fallback)
        throw new Error('VISION_PROVIDER_NOT_CONFIGURED');
      return this.options.fallback.analyze(clips);
    }
    log.info(
      { provider: 'openai', model: config.OPENAI_MODEL, frames: this.options.framePaths.length },
      'Vision provider: openai',
    );
    try {
      const parsed = await analyzeMomentFramesOpenAI({
        frames: this.options.framePaths,
        style: this.style,
        prompt: this.options.prompt,
        cameras: clips.map((clip) => clip.position),
      });
      return decisionFromVision(
        clips,
        parsed,
        this.style,
        this.options.framePaths.length,
        'openai',
        config.OPENAI_MODEL,
      );
    } catch (error) {
      const wrapped = openaiFailure(error);
      const realFallback =
        this.options.fallback && !(this.options.fallback instanceof HeuristicAnalyzer);
      if (isHiddenBugFallback(wrapped.message)) throw wrapped;
      if (realFallback && isTransientProviderError(wrapped.message)) {
        log.warn(
          {
            err: wrapped.message,
            provider_requested: 'openai',
            fallback_reason: wrapped.message.split(':')[0],
          },
          'openai transient; switching to configured real fallback',
        );
        return this.options.fallback!.analyze(clips);
      }
      if (config.REQUIRE_REAL_VISION || !this.options.fallback) throw wrapped;
      log.warn({ err: wrapped.message }, 'openai analysis failed; using local heuristic');
      return this.options.fallback.analyze(clips);
    }
  }
}

export async function analyzeMomentFramesOpenAI(input: {
  frames: VisionFrame[];
  style: StyleName;
  prompt?: string;
  cameras: number[];
}): Promise<GeminiHighlight> {
  const { readFile } = await import('node:fs/promises');
  const selected = input.frames.slice(0, 24);
  const content: Array<Record<string, unknown>> = [];
  for (const frame of selected) {
    const bytes = await readFile(frame.path);
    content.push({ type: 'text', text: `C${frame.cameraPosition}` });
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
        detail: 'low',
      },
    });
  }
  content.push({ type: 'text', text: buildFramePrompt(input.style, input.cameras, input.prompt) });
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    }),
  });
  const payload = (await response.json()) as {
    error?: { message?: string; code?: string; type?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!response.ok) throw openaiFailure(payload.error?.message ?? `OPENAI_HTTP_${response.status}`);
  const text = payload.choices?.[0]?.message?.content ?? '';
  log.info(
    {
      provider: 'openai',
      model: config.OPENAI_MODEL,
      frames: selected.length,
      promptTokens: payload.usage?.prompt_tokens,
      completionTokens: payload.usage?.completion_tokens,
    },
    'openai vision complete',
  );
  return geminiHighlightSchema.parse(JSON.parse(stripJsonFence(text)));
}

function openaiFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /invalid_api_key|incorrect api key|insufficient_quota|access_terminated|permission/i.test(
      message,
    ) ||
    /OPENAI_HTTP_401|OPENAI_HTTP_403/.test(message)
  ) {
    return new Error('OPENAI_API_BLOCKED');
  }
  return error instanceof Error ? error : new Error(message);
}

export function createAnalyzer(
  style: string,
  options?: { clipPath?: string; framePaths?: VisionFrame[]; prompt?: string },
): SceneAnalyzer {
  const resolved: StyleName = ['natural', 'dynamic', 'cinematic'].includes(style)
    ? (style as StyleName)
    : 'natural';
  const kind = configuredVisionKind();
  const heuristic = config.REQUIRE_REAL_VISION ? undefined : new HeuristicAnalyzer(resolved);
  if (kind === 'heuristic') {
    if (config.REQUIRE_REAL_VISION) throw new Error('VISION_PROVIDER_NOT_CONFIGURED');
    return new HeuristicAnalyzer(resolved);
  }
  const openaiSecondary = config.OPENAI_API_KEY
    ? new OpenAIVisionProvider(resolved, {
        framePaths: options?.framePaths,
        prompt: options?.prompt,
        fallback: heuristic,
      })
    : undefined;
  const geminiSecondary = config.GEMINI_API_KEY
    ? new GeminiVisionProvider(resolved, {
        clipPath: options?.clipPath,
        framePaths: options?.framePaths,
        prompt: options?.prompt,
        fallback: heuristic,
      })
    : undefined;
  if (kind === 'openai') {
    return new OpenAIVisionProvider(resolved, {
      framePaths: options?.framePaths,
      prompt: options?.prompt,
      fallback: geminiSecondary ?? heuristic,
    });
  }
  return new GeminiVisionProvider(resolved, {
    clipPath: options?.clipPath,
    framePaths: options?.framePaths,
    prompt: options?.prompt,
    fallback: openaiSecondary ?? heuristic,
  });
}
