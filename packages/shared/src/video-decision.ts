import { z } from 'zod';

export const PIPELINE_VERSION = '2.0';
export const DIRECTOR_SCHEMA_VERSION = '1.0';
export const DESIGN_SYSTEM_VERSION = '1.0';
export const TEMPLATE_VERSION = '1.0';

export const videoPaces = ['slow', 'medium', 'medium_fast', 'fast'] as const;
export type VideoPace = (typeof videoPaces)[number];

export const videoTransitions = [
  'hard_cut',
  'soft_dissolve',
  'dip_to_black',
  'directional_push',
  'masked_reveal',
] as const;
export type VideoTransition = (typeof videoTransitions)[number];

export const videoMotions = [
  'none',
  'slow_push',
  'slow_pull',
  'subtle_pan',
  'subject_focus',
  'punch_in',
  'freeze_emphasis',
] as const;
export type VideoMotion = (typeof videoMotions)[number];

export const audioStrategies = [
  'original_audio',
  'music_only',
  'ambient_plus_music',
  'voiceover_plus_music',
  'voiceover_plus_ambient',
  'cinematic',
] as const;
export type AudioStrategy = (typeof audioStrategies)[number];

export const cropStrategies = ['subject_focus', 'center_crop', 'pad_blur'] as const;
export const sceneRoles = ['hook', 'body', 'insert', 'payoff', 'ending'] as const;
export const captionStrategies = ['none', 'speech_only', 'full'] as const;

const score = z.number().int().min(0).max(100);

export const videoEditSceneSchema = z
  .object({
    recordingId: z.string().min(1).optional(),
    cameraId: z.string().min(1),
    sourceStartMs: z.number().int().min(0).max(3_600_000),
    sourceEndMs: z.number().int().positive().max(3_600_000),
    role: z.enum(sceneRoles),
    cropStrategy: z.enum(cropStrategies).default('center_crop'),
    motion: z.enum(videoMotions).default('none'),
    transitionOut: z.enum(videoTransitions).default('hard_cut'),
    importance: score.default(50),
  })
  .refine((scene) => scene.sourceEndMs > scene.sourceStartMs, {
    message: 'sourceEndMs must be after sourceStartMs',
    path: ['sourceEndMs'],
  });

export const videoEditDecisionSchema = z.object({
  schemaVersion: z.literal('1.0'),
  tenantId: z.string().uuid(),
  restaurantId: z.string().uuid(),
  momentId: z.string().uuid().optional(),
  reelId: z.string().uuid().optional(),
  program: z.enum(['casa', 'oficio', 'assinatura', 'pulso']),
  confidence: score,
  scoreScale: z.literal('0-100'),
  durationTargetMs: z.number().int().min(1000).max(180_000),
  story: z.object({
    type: z.string().min(1).max(40),
    hookScore: score,
    pace: z.enum(videoPaces),
    emotion: z.string().min(1).max(40),
  }),
  scenes: z.array(videoEditSceneSchema).min(1).max(16),
  audio: z.object({
    strategy: z.enum(audioStrategies),
    preserveAmbient: z.boolean(),
    originalGainDb: z.number().min(-60).max(12).nullable(),
    musicGainDb: z.number().min(-60).max(12).nullable(),
    voiceGainDb: z.number().min(-60).max(12).nullable(),
  }),
  text: z.object({
    enabled: z.boolean(),
    title: z.string().max(80).nullable(),
    subtitle: z.string().max(120).nullable(),
    cta: z.string().max(40).nullable(),
  }),
  captions: z.object({
    strategy: z.enum(captionStrategies),
  }),
  branding: z.object({
    profileId: z.string().max(80).nullable(),
    showLogo: z.boolean(),
  }),
  qualityRequirements: z.object({
    minimumVisualScore: score.default(0),
  }),
});

export type VideoEditDecisionV1 = z.infer<typeof videoEditDecisionSchema>;

export function parseVideoEditDecision(input: unknown) {
  return videoEditDecisionSchema.safeParse(input);
}

function clampScore(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 70;
  const scaled = n > 0 && n < 1 ? n * 100 : n;
  return Math.min(100, Math.max(0, Math.round(scaled)));
}

function msFromModel(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 3_600_000) return Math.min(3_600_000, Math.round(n));
  if (n > 0 && n < 1000) return Math.round(n * 1000);
  return Math.round(n);
}

export function repairVideoEditDecision(input: unknown) {
  const first = videoEditDecisionSchema.safeParse(input);
  if (first.success) return first;
  if (!input || typeof input !== 'object') return first;
  const raw = { ...(input as Record<string, unknown>) };
  if (raw.schemaVersion !== '1.0') raw.schemaVersion = '1.0';
  if (raw.scoreScale !== '0-100') raw.scoreScale = '0-100';
  raw.confidence = clampScore(raw.confidence);
  raw.durationTargetMs = msFromModel(raw.durationTargetMs) || 12_000;
  if (Number(raw.durationTargetMs) < 1000) raw.durationTargetMs = 12_000;
  if (raw.story && typeof raw.story === 'object') {
    const story = { ...(raw.story as Record<string, unknown>) };
    story.hookScore = clampScore(story.hookScore);
    story.type = String(story.type ?? 'experience').slice(0, 40);
    story.emotion = String(story.emotion ?? 'premium_warm').slice(0, 40);
    if (!videoPaces.includes(story.pace as (typeof videoPaces)[number])) story.pace = 'medium';
    raw.story = story;
  }
  if (Array.isArray(raw.scenes)) {
    raw.scenes = raw.scenes.slice(0, 16).map((scene) => {
      const item =
        scene && typeof scene === 'object' ? { ...(scene as Record<string, unknown>) } : {};
      item.sourceStartMs = msFromModel(item.sourceStartMs);
      item.sourceEndMs = Math.max(Number(item.sourceStartMs) + 1, msFromModel(item.sourceEndMs));
      if (!cropStrategies.includes(item.cropStrategy as (typeof cropStrategies)[number]))
        item.cropStrategy = 'center_crop';
      if (!videoMotions.includes(item.motion as (typeof videoMotions)[number])) {
        item.motion =
          item.motion === 'drift' ? 'slow_push' : item.motion === 'punch' ? 'punch_in' : 'none';
      }
      if (!videoTransitions.includes(item.transitionOut as (typeof videoTransitions)[number]))
        item.transitionOut = 'hard_cut';
      if (!sceneRoles.includes(item.role as (typeof sceneRoles)[number])) item.role = 'body';
      item.importance = clampScore(item.importance);
      item.cameraId = String(item.cameraId ?? 'cam-1');
      return item;
    });
  }
  if (raw.audio && typeof raw.audio === 'object') {
    const audio = { ...(raw.audio as Record<string, unknown>) };
    if (!audioStrategies.includes(audio.strategy as (typeof audioStrategies)[number]))
      audio.strategy = 'original_audio';
    if (audio.musicGainDb === undefined) audio.musicGainDb = null;
    if (audio.voiceGainDb === undefined) audio.voiceGainDb = null;
    if (audio.originalGainDb === undefined) audio.originalGainDb = -16;
    if (typeof audio.preserveAmbient !== 'boolean') audio.preserveAmbient = true;
    raw.audio = audio;
  }
  if (!raw.text || typeof raw.text !== 'object') {
    const title = typeof raw.title === 'string' ? raw.title.slice(0, 80) : null;
    raw.text = { enabled: Boolean(title), title, subtitle: null, cta: null };
  } else {
    const text = { ...(raw.text as Record<string, unknown>) };
    if (typeof text.title === 'string') text.title = text.title.slice(0, 80);
    if (typeof text.subtitle === 'string') text.subtitle = text.subtitle.slice(0, 120);
    if (typeof text.cta === 'string') text.cta = text.cta.slice(0, 40);
    raw.text = text;
  }
  if (raw.captions && typeof raw.captions === 'object') {
    const captions = { ...(raw.captions as Record<string, unknown>) };
    if (!captionStrategies.includes(captions.strategy as (typeof captionStrategies)[number]))
      captions.strategy = 'none';
    raw.captions = captions;
  }
  if (!raw.qualityRequirements || typeof raw.qualityRequirements !== 'object') {
    raw.qualityRequirements = { minimumVisualScore: 0 };
  }
  return videoEditDecisionSchema.safeParse(raw);
}
