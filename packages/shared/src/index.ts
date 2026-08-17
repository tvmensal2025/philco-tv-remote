import { z } from 'zod';

export const reelStatuses = [
  'queued',
  'collecting',
  'analyzing',
  'rendering',
  'uploading',
  'ready',
  'approved',
  'publishing',
  'published',
  'discarded',
  'failed',
] as const;
export type ReelStatus = (typeof reelStatuses)[number];

export const markMomentSchema = z.object({
  restaurantId: z.string().uuid(),
  occurredAt: z.string().datetime().optional(),
  label: z.string().trim().max(120).optional(),
  beforeSeconds: z.number().int().min(3).max(120).optional(),
  afterSeconds: z.number().int().min(3).max(120).optional(),
  category: z
    .enum(['moment', 'food', 'crowd', 'event', 'preparation', 'customer', 'other'])
    .optional(),
  clientRequestId: z.string().uuid().optional(),
});

export const onboardingSchema = z.object({
  organizationName: z.string().trim().min(2).max(80),
  restaurantName: z.string().trim().min(2).max(80),
  timezone: z.string().trim().min(3).max(80).default('America/Sao_Paulo'),
});

export const restaurantSettingsSchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  timezone: z.string().trim().min(3).max(80),
  windowBefore: z.number().int().min(3).max(120),
  windowAfter: z.number().int().min(3).max(120),
  activeStyle: z.enum(['natural', 'dynamic', 'cinematic']),
  autoCaptureMotion: z.boolean().optional(),
  capturePrompt: z.string().trim().max(500).optional(),
  autoHighlights: z.boolean().optional(),
  maxAutoReelsPerDay: z.number().int().min(0).max(200).optional(),
  highlightMinScore: z.number().int().min(0).max(100).optional(),
  whatsappDaily: z.boolean().optional(),
  whatsappPhone: z
    .string()
    .trim()
    .max(24)
    .transform((value) => value.replace(/\D/g, ''))
    .refine(
      (value) => value === '' || (value.length >= 10 && value.length <= 15),
      'Use DDI + DDD. Ex: 5511999999999',
    )
    .optional(),
  digestHour: z.number().int().min(0).max(23).optional(),
});

export function parseSegmentStartMs(objectPathOrName: string): number {
  const filename = objectPathOrName.split('/').pop() ?? objectPathOrName;
  const stem = filename.replace(/\.mp4$/i, '');
  const numeric = Number(stem);
  if (Number.isFinite(numeric) && numeric > 1_000_000_000_000) return numeric;
  if (Number.isFinite(numeric) && numeric > 1_000_000_000) return numeric * 1000;
  const parsed = Date.parse(stem);
  return Number.isNaN(parsed) ? NaN : parsed;
}

export const cameraRoles = ['master', 'side', 'food', 'ambience'] as const;
export type CameraRole = (typeof cameraRoles)[number];

export const editPrograms = ['casa', 'oficio', 'assinatura', 'pulso'] as const;
export type EditProgram = (typeof editPrograms)[number];

export const editProgramLabels: Record<EditProgram, string> = {
  casa: 'Casa',
  oficio: 'Ofício',
  assinatura: 'Assinatura',
  pulso: 'Pulso',
};

export function defaultCameraRole(position: number): CameraRole {
  if (position === 2) return 'side';
  if (position === 3) return 'food';
  if (position === 4) return 'ambience';
  return 'master';
}

export function parseCameraRole(value: unknown): CameraRole | undefined {
  if (value === 'service' || value === 'master') return 'master';
  if (value === 'kitchen' || value === 'side') return 'side';
  if (value === 'food') return 'food';
  if (value === 'ambience' || value === 'ambiente') return 'ambience';
  return undefined;
}

export const cameraUpdateSchema = z.object({
  cameraId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  enabled: z.boolean(),
  storagePrefix: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .regex(/^[a-zA-Z0-9/_-]+$/)
    .optional(),
  role: z.enum(cameraRoles).optional(),
  sourceType: z.enum(['minio', 'rtsp', 'nvr']).optional(),
  ingestMode: z.enum(['folder', 'rtsp', 'phone']).optional(),
  rtspUrl: z.string().trim().max(800).optional(),
  rtspHost: z.string().trim().max(120).optional(),
  rtspPort: z.string().trim().max(8).optional(),
  rtspUsername: z.string().trim().max(80).optional(),
  rtspPassword: z.string().max(200).optional(),
  rtspBrand: z.enum(['intelbras', 'hikvision', 'dahua', 'xm', 'generic']).optional(),
  rtspChannel: z.number().int().min(1).max(16).optional(),
  rtspTransport: z.enum(['tcp', 'udp']).optional(),
  folderPath: z.string().trim().max(400).optional(),
});

export const ingestPresignSchema = z.object({
  restaurantId: z.string().uuid(),
  cameraPosition: z.number().int().min(1).max(16),
  capturedAt: z.string().datetime(),
  contentType: z.literal('video/mp4').default('video/mp4'),
});

export const ingestCompleteSchema = z.object({
  cameraId: z.string().uuid(),
  objectPath: z.string().trim().min(10).max(1000),
  capturedAt: z.string().datetime(),
  expectedBytes: z.number().int().positive().max(2_147_483_648),
  endedAt: z.string().datetime().optional(),
  durationSeconds: z.number().positive().max(3600).optional(),
  checksum: z.string().trim().min(8).max(128).optional(),
  timestampSource: z
    .enum(['filename', 'nvr_pattern', 'file_metadata', 'filesystem_mtime', 'fallback'])
    .optional(),
  timestampConfidence: z.enum(['exact', 'derived', 'fallback']).optional(),
  idempotencyKey: z.string().trim().min(16).max(128).optional(),
});

export const reelActionSchema = z.object({
  action: z.enum(['approve', 'discard', 'publish', 'retry']),
  provider: z.string().max(40).optional(),
});

const isoDateTime = z.preprocess((value) => {
  if (typeof value !== 'string' || !value.trim()) return value;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}, z.string().datetime());

export const videoJobSchema = z.object({
  jobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  restaurantId: z.string().uuid(),
  momentId: z.string().uuid(),
  reelId: z.string().uuid(),
  occurredAt: isoDateTime,
  windowStart: isoDateTime,
  windowEnd: isoDateTime,
  program: z.enum(editPrograms).default('assinatura'),
});
export type VideoJob = z.infer<typeof videoJobSchema>;

export const indexJobSchema = z.object({
  recordingId: z.string().uuid(),
  tenantId: z.string().uuid(),
  restaurantId: z.string().uuid(),
  cameraId: z.string().uuid(),
  objectPath: z.string().min(10).max(1000),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
});
export type IndexJob = z.infer<typeof indexJobSchema>;

export const highlightJobSchema = z.object({
  tenantId: z.string().uuid(),
  restaurantId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  bucketMs: z.number().int(),
});
export type HighlightJob = z.infer<typeof highlightJobSchema>;

export const highlightSceneSchema = z.object({
  cameraPosition: z.number().int().min(1).max(16),
  startOffsetSeconds: z.number().min(0),
  durationSeconds: z.number().positive().max(30),
  reason: z.string().max(240),
});

const score100 = z.coerce.number().min(0).max(100);

function clipText(value: unknown, max: number) {
  return typeof value === 'string' ? value.slice(0, max) : value;
}

function asCameraRows(raw: unknown) {
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const position = Number(row.cameraPosition ?? row.camera_position);
    if (!Number.isInteger(position) || position < 1 || position > 16) return [];
    return [
      {
        cameraPosition: position,
        score: row.score,
        offsetSeconds: row.offsetSeconds ?? row.offset_seconds,
        reason: clipText(row.reason, 240),
      },
    ];
  });
}

export const geminiHighlightSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const value = raw as Record<string, unknown>;
    const detailed = (value.detailedScores ?? value.detailed_scores ?? {}) as Record<
      string,
      unknown
    >;
    const rankings = asCameraRows(value.cameraRankings ?? value.camera_rankings);
    const frames = asCameraRows(value.bestFrames ?? value.best_frames);
    const scenes = Array.isArray(value.scenes)
      ? value.scenes.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const scene = item as Record<string, unknown>;
          const position = Number(scene.cameraPosition ?? scene.camera_position);
          return [
            {
              ...scene,
              cameraPosition:
                Number.isInteger(position) && position >= 1 && position <= 16 ? position : 1,
              reason: clipText(scene.reason, 240),
            },
          ];
        })
      : value.scenes;
    return {
      ...value,
      score: value.score ?? value.overall_score,
      reason: clipText(value.reason, 400),
      captionPt: clipText(value.captionPt ?? value.caption_pt, 500),
      detailedScores: {
        food: detailed.food ?? value.food_score ?? value.foodScore,
        action: detailed.action ?? value.action_score ?? value.actionScore,
        visual: detailed.visual ?? value.visual_score ?? value.visualScore,
        marketing: detailed.marketing ?? value.marketing_score ?? value.marketingScore,
        ambience: detailed.ambience ?? value.ambience_score ?? value.ambienceScore,
      },
      peopleScore: value.peopleScore ?? value.people_score,
      storyScore: value.storyScore ?? value.story_score,
      privacyRisk: clipText(value.privacyRisk ?? value.privacy_risk, 200),
      recommendedUse: clipText(value.recommendedUse ?? value.recommended_use, 200),
      cameraRankings: rankings,
      bestFrames: frames,
      scenes,
    };
  },
  z.object({
    score: score100,
    reason: z.string().max(400),
    detailedScores: z.object({
      food: score100,
      action: score100,
      visual: score100,
      marketing: score100,
      ambience: score100,
    }),
    scenes: z.array(highlightSceneSchema).min(1).max(12),
    captionPt: z
      .string()
      .max(500)
      .nullish()
      .transform((value) => value ?? ''),
    hashtags: z
      .array(z.string().max(40))
      .max(12)
      .nullish()
      .transform((value) => value ?? []),
    peopleScore: score100.optional(),
    storyScore: score100.optional(),
    confidence: score100.optional(),
    privacyRisk: z.string().max(200).optional(),
    recommendedUse: z.string().max(200).optional(),
    cameraRankings: z
      .array(
        z.object({
          cameraPosition: z.coerce.number().int().min(1).max(16),
          score: score100,
          reason: z.string().max(240),
        }),
      )
      .max(16)
      .optional(),
    bestFrames: z
      .array(
        z.object({
          cameraPosition: z.coerce.number().int().min(1).max(16),
          offsetSeconds: z.coerce.number().min(0).optional(),
          reason: z.string().max(240).optional(),
        }),
      )
      .max(16)
      .optional(),
  }),
);
export type GeminiHighlight = z.infer<typeof geminiHighlightSchema>;

export const HIGHLIGHT_WINDOW_MS = 4_000;
export const HIGHLIGHT_FUSE_MS = 2_000;
export const HIGHLIGHT_CLIP_SECONDS = 12;

export function highlightBucketMs(occurredAtMs: number, windowMs = HIGHLIGHT_WINDOW_MS) {
  return Math.floor(occurredAtMs / windowMs) * windowMs;
}

export const QUEUES = {
  video: 'video-pipeline',
  publishing: 'reel-publishing',
  index: 'segment-index',
  highlight: 'highlight-analyze',
  digest: 'daily-digest',
} as const;

export const digestJobSchema = z.object({
  tenantId: z.string().uuid(),
  restaurantId: z.string().uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type DigestJob = z.infer<typeof digestJobSchema>;

export * from './paths.js';
export * from './signed-media.js';
export * from './ingest.js';
export * from './video-decision.js';
export * from './video-decision-v2.js';
export * from './edit-intensity.js';
export * from './crop.js';
export * from './quality.js';
export * from './job-failure.js';
export * from './brand.js';
export * from './render-manifest.js';
export * from './storage.js';
export * from './program-preset.js';
export * from './program-timeline.js';
export * from './scale.js';
export * from './quality-first.js';
export * from './scene-coherence.js';
export * from './beat-grid.js';
export * from './reel-duration.js';
export * from './fx-catalog.js';
export * from './rtsp.js';
export * from './video-project.js';
export * from './video-project-ops.js';
export * from './video-project-from-decision.js';
export * from './video-project-compiler.js';
export * from './video-project-preview.js';
export * from './video-project-ai.js';
export * from './adobe-av.js';
