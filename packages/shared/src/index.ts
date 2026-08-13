import { z } from "zod";

export const reelStatuses = [
  "queued", "collecting", "analyzing", "rendering", "uploading",
  "ready", "approved", "publishing", "published", "discarded", "failed"
] as const;
export type ReelStatus = (typeof reelStatuses)[number];

export const markMomentSchema = z.object({
  restaurantId: z.string().uuid(),
  occurredAt: z.string().datetime().optional(),
  label: z.string().trim().max(120).optional(),
  beforeSeconds: z.number().int().min(3).max(120).optional(),
  afterSeconds: z.number().int().min(3).max(120).optional()
});

export const onboardingSchema = z.object({
  organizationName: z.string().trim().min(2).max(80),
  restaurantName: z.string().trim().min(2).max(80),
  timezone: z.string().trim().min(3).max(80).default("America/Sao_Paulo")
});

export const restaurantSettingsSchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  timezone: z.string().trim().min(3).max(80),
  windowBefore: z.number().int().min(3).max(120),
  windowAfter: z.number().int().min(3).max(120),
  activeStyle: z.enum(["natural", "dynamic", "cinematic"])
});

export const cameraUpdateSchema = z.object({
  cameraId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  enabled: z.boolean(),
  storagePrefix: z.string().trim().min(3).max(500).regex(/^[a-zA-Z0-9/_-]+$/)
});

export const ingestPresignSchema = z.object({
  restaurantId: z.string().uuid(),
  cameraPosition: z.number().int().min(1).max(16),
  capturedAt: z.string().datetime(),
  contentType: z.literal("video/mp4").default("video/mp4")
});

export const ingestCompleteSchema = z.object({
  cameraId: z.string().uuid(),
  objectPath: z.string().trim().min(10).max(1000),
  capturedAt: z.string().datetime(),
  expectedBytes: z.number().int().positive().max(2_147_483_648)
});

export const reelActionSchema = z.object({
  action: z.enum(["approve", "discard", "publish", "retry"]),
  provider: z.string().max(40).optional()
});

export const videoJobSchema = z.object({
  jobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  restaurantId: z.string().uuid(),
  momentId: z.string().uuid(),
  reelId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime()
});
export type VideoJob = z.infer<typeof videoJobSchema>;

export const QUEUES = { video: "video-pipeline", publishing: "reel-publishing" } as const;
