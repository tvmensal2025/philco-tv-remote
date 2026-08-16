import { z } from 'zod';
import { resolve } from 'node:path';
import { loadRootEnv } from './load-root-env.js';

loadRootEnv();

export const config = z
  .object({
    REDIS_URL: z.string(),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string(),
    MINIO_ENDPOINT: z.preprocess(
      () =>
        (process.env.MINIO_ENDPOINT || process.env.MINIO_SERVER_URL || '')
          .replace(/^https?:\/\//i, '')
          .replace(/\/$/, ''),
      z.string().min(1),
    ),
    MINIO_PORT: z.preprocess(
      (value) => value || (/^https:/i.test(process.env.MINIO_SERVER_URL ?? '') ? '443' : undefined),
      z.coerce.number().default(9000),
    ),
    MINIO_USE_SSL: z.preprocess(
      (value) =>
        typeof value === 'string' && value.length
          ? value
          : /^https:/i.test(process.env.MINIO_SERVER_URL ?? '')
            ? 'true'
            : 'false',
      z.string().transform((value) => value === 'true'),
    ),
    MINIO_ACCESS_KEY: z.preprocess(
      () => process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER,
      z.string().min(1),
    ),
    MINIO_SECRET_KEY: z.preprocess(
      () => process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD,
      z.string().min(8),
    ),
    MINIO_BUCKET: z.string().default('cenapronta'),
    VIDEO_WORKER_CONCURRENCY: z.preprocess(
      (value) => value ?? process.env.WORKER_CONCURRENCY ?? 1,
      z.coerce.number().int().min(1).max(2),
    ),
    INDEX_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
    HIGHLIGHT_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
    RENDER_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
    FFMPEG_PRESET: z.string().default('veryfast'),
    FFMPEG_THREADS: z.coerce.number().int().min(0).max(8).default(2),
    RENDER_PROFILE: z.preprocess(
      (value) => {
        const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'standard';
        return ['high', 'standard', 'safe'].includes(normalized) ? normalized : 'standard';
      },
      z.enum(['high', 'standard', 'safe']).default('standard'),
    ),
    VISION_MAX_FRAMES: z.coerce.number().int().min(1).max(8).default(4),
    LOG_LEVEL: z.string().default('info'),
    NVR_SEGMENT_SECONDS: z.coerce.number().int().min(5).max(600).default(60),
    RAW_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    WORK_DIR: z.preprocess(
      (value) => resolve(typeof value === 'string' && value.trim() ? value.trim() : 'work/reelops'),
      z.string().min(1),
    ),
    GEMINI_API_KEY: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim().length >= 10 ? value.trim() : undefined,
      z.string().min(10).optional(),
    ),
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
    OPENAI_API_KEY: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim().startsWith('sk-') && value.trim().length >= 20
          ? value.trim()
          : undefined,
      z.string().min(20).optional(),
    ),
    OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
    VISION_PROVIDER: z.preprocess(
      (value) => {
        const raw =
          (typeof value === 'string' && value.trim()
            ? value
            : process.env.VISION_PROVIDER_PRIMARY) ?? 'openai';
        const normalized = String(raw).trim().toLowerCase();
        return ['openai', 'gemini', 'auto'].includes(normalized) ? normalized : 'openai';
      },
      z.enum(['openai', 'gemini', 'auto']).default('openai'),
    ),
    VISION_PROVIDER_SECONDARY: z.preprocess(
      (value) => {
        const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
        return ['openai', 'gemini'].includes(normalized) ? normalized : undefined;
      },
      z.enum(['openai', 'gemini']).optional(),
    ),
    ENABLE_REVIDEO: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    ENABLE_ELEVENLABS: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    ELEVENLABS_API_KEY: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim().length >= 20 ? value.trim() : undefined,
      z.string().min(20).optional(),
    ),
    ELEVENLABS_VOICE_ID: z.preprocess(
      (value) => (typeof value === 'string' && value.trim().length >= 8 ? value.trim() : undefined),
      z.string().min(8).optional(),
    ),
    ELEVENLABS_MODEL_ID: z.string().default('eleven_multilingual_v2'),
    ELEVENLABS_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120_000).default(45_000),
    ENABLE_VISUAL_QC: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    ENABLE_AUTO_REPAIR: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    ENABLE_AI_DIRECTOR: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    REQUIRE_AI_DIRECTOR: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    REQUIRE_REVIDEO_RENDER: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    ENABLE_MULTICAMERA_RANKER: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(true),
    ),
    ENABLE_YOLO: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    ENABLE_TRACKING: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(true),
    ),
    ENABLE_SMART_REFRAME: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(true),
    ),
    ENABLE_BEAT_EDITING: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(true),
    ),
    ENABLE_TRACKING_QC: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    STALE_JOB_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(1_200_000),
    WORKER_HEARTBEAT_STALE_MS: z.coerce.number().int().min(30_000).max(600_000).default(90_000),
    MAX_JOB_RECOVERIES: z.coerce.number().int().min(0).max(5).default(2),
    REVIDEO_FORCE_FAIL: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    VIDEO_PIPELINE_VERSION: z.string().default('2.0'),
    QC_MIN_VISUAL_SCORE: z.coerce.number().int().min(0).max(100).default(0),
    QC_MIN_BRAND_SCORE: z.coerce.number().int().min(0).max(100).default(0),
    QC_MIN_STORY_SCORE: z.coerce.number().int().min(0).max(100).default(0),
    MAX_AUTO_REPAIR_ATTEMPTS: z.coerce.number().int().min(0).max(3).default(1),
    FFMPEG_HWACCEL: z.string().default('none'),
    REQUIRE_REAL_VISION: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    ALLOW_STORAGE_SCAN_FALLBACK: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes'].includes(value.trim().toLowerCase())
          : value,
      z.boolean().default(false),
    ),
    HIGHLIGHT_DAILY_CAP: z.coerce.number().int().min(0).max(200).default(24),
    HIGHLIGHT_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(58),
    META_ACCESS_TOKEN: z.string().optional(),
    META_INSTAGRAM_ACCOUNT_ID: z.string().optional(),
    META_GRAPH_API_VERSION: z.string().default('v23.0'),
    MINIO_PUBLIC_ENDPOINT: z.string().optional(),
    MINIO_PUBLIC_PORT: z.coerce.number().int().positive().default(443),
    MINIO_PUBLIC_SSL: z
      .string()
      .default('true')
      .transform((value) => value === 'true'),
    WAME_SERVER: z.preprocess(
      (value) =>
        typeof value === 'string' && /^https?:\/\//i.test(value.trim())
          ? value.trim().replace(/\/$/, '')
          : 'https://us.api-wa.me',
      z.string().url(),
    ),
    WAME_API_KEY: z.preprocess((value) => {
      const direct = typeof value === 'string' ? value.trim() : '';
      const shared = process.env.WAME_API_KEY_RITA?.trim() ?? '';
      const key = direct.length >= 8 ? direct : shared;
      return key.length >= 8 ? key : undefined;
    }, z.string().min(8).optional()),
    APP_URL: z.preprocess(
      (value) =>
        typeof value === 'string' && /^https?:\/\//i.test(value.trim())
          ? value.trim().replace(/\/$/, '')
          : undefined,
      z.string().url().optional(),
    ),
    INGEST_API_KEY: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim().length >= 24 ? value.trim() : undefined,
      z.string().min(24).optional(),
    ),
    YOLO_URL: z.preprocess(
      (value) =>
        typeof value === 'string' && /^https?:\/\//i.test(value.trim())
          ? value.trim().replace(/\/$/, '')
          : undefined,
      z.string().url().optional(),
    ),
    YOLO_API_KEY: z.preprocess(
      (value) => (typeof value === 'string' && value.trim().length >= 8 ? value.trim() : undefined),
      z.string().min(8).optional(),
    ),
    YOLO_TIMEOUT_MS: z.coerce.number().int().min(3000).max(60_000).default(15_000),
    YOLO_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
    VISION_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    FFMPEG_MAX_PROCESSES: z.coerce.number().int().min(1).max(8).default(2),
    STORAGE_QUOTA_BYTES_PER_TENANT: z.coerce.number().int().min(0).default(0),
    MAX_ACTIVE_JOBS_PER_TENANT: z.coerce.number().int().min(1).max(32).default(4),
    MAX_RENDER_JOBS_PER_TENANT: z.coerce.number().int().min(1).max(8).default(1),
    TENANT_FAIRNESS_DELAY_MS: z.coerce.number().int().min(1000).max(60_000).default(8_000),
    WORKER_ENVIRONMENT: z.string().optional(),
    WORKER_DEPLOYMENT: z.string().default('easypanel'),
    WORKER_VERSION: z.string().default('0.1.0'),
    WORKER_NODE_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  })
  .parse(process.env);
