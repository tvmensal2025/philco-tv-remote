import { Worker } from 'bullmq';
import { calendarDay, clockHour, editPrograms, QUEUES } from '@reelops/shared';
import { hostname } from 'node:os';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { redis, log, db, minio } from './services.js';
import { processVideo } from './pipeline/video-job.js';
import { processIndex } from './pipeline/index-job.js';
import { processHighlight } from './pipeline/highlight-job.js';
import { processDigest } from './pipeline/digest-job.js';
import { createPublisher } from './adapters/publisher.js';
import { configuredVisionKind } from './adapters/analyzer.js';
import { digestJobs, enqueueUnique, indexJobs, videoJobs } from './queues.js';
import { runtimeStatus } from './runtime-status.js';
import { isRealVisionProvider } from './adapters/vision-provider.js';
import {
  IN_FLIGHT_REEL_STATUSES,
  isLiveQueueJob,
  planStaleRecovery,
  recoveryCountFromMetadata,
  type StaleReel,
} from './engine/job-recovery.js';
import { setStatus } from './pipeline/status.js';
import { bootstrapStorage } from './storage-lifecycle.js';

await bootstrapStorage({
  minio,
  bucket: config.MINIO_BUCKET,
  retentionDays: config.RAW_RETENTION_DAYS,
  log,
});
await mkdir(config.WORK_DIR, { recursive: true });
await cleanupStaleWork();
const workerId = `${hostname()}-${process.pid}`;
const videoConcurrency = Math.min(
  config.VIDEO_WORKER_CONCURRENCY,
  config.RENDER_WORKER_CONCURRENCY,
  2,
);

const video = new Worker(QUEUES.video, processVideo, {
  connection: redis,
  concurrency: videoConcurrency,
  lockDuration: 15 * 60 * 1000,
});
const index = new Worker(QUEUES.index, processIndex, {
  connection: redis,
  concurrency: config.INDEX_WORKER_CONCURRENCY,
  lockDuration: 5 * 60 * 1000,
});
const highlight = new Worker(QUEUES.highlight, processHighlight, {
  connection: redis,
  concurrency: config.HIGHLIGHT_WORKER_CONCURRENCY,
  lockDuration: 8 * 60 * 1000,
  limiter: { max: 12, duration: 60_000 },
});
const digest = new Worker(QUEUES.digest, processDigest, {
  connection: redis,
  concurrency: 1,
  lockDuration: 10 * 60 * 1000,
});
const publishing = new Worker(
  QUEUES.publishing,
  async (job) => {
    const { publicationId, reelId, tenantId, provider } = job.data as {
      publicationId: string;
      reelId: string;
      tenantId: string;
      provider: string;
    };
    const { data: reel } = await db
      .from('reels')
      .select('output_path,title,caption')
      .eq('id', reelId)
      .eq('tenant_id', tenantId)
      .single();
    if (!reel?.output_path) throw new Error('REEL_FILE_NOT_FOUND');
    await db
      .from('publications')
      .update({ status: 'publishing' })
      .eq('id', publicationId)
      .eq('tenant_id', tenantId);
    try {
      const result = await createPublisher(provider).publish({
        reelId,
        provider,
        objectPath: reel.output_path,
        caption: reel.caption || reel.title || 'Um momento especial ✨',
      });
      const { error: publicationError } = await db
        .from('publications')
        .update({ status: 'published', external_id: result.externalId, error_message: null })
        .eq('id', publicationId)
        .eq('tenant_id', tenantId);
      if (publicationError) throw publicationError;
      const { error: reelError } = await db
        .from('reels')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', reelId)
        .eq('tenant_id', tenantId)
        .eq('status', 'publishing');
      if (reelError) throw reelError;
    } catch (error) {
      const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
      if (finalAttempt) {
        await db
          .from('publications')
          .update({
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Erro',
          })
          .eq('id', publicationId)
          .eq('tenant_id', tenantId);
        await db
          .from('reels')
          .update({ status: 'approved' })
          .eq('id', reelId)
          .eq('tenant_id', tenantId)
          .eq('status', 'publishing');
      }
      throw error;
    }
  },
  { connection: redis, concurrency: 1, lockDuration: 10 * 60 * 1000 },
);

async function sweepPendingRecordings() {
  const { data, error } = await db
    .from('recordings')
    .select('id,tenant_id,restaurant_id,camera_id,object_key,started_at,ended_at')
    .eq('index_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(40);
  if (error || !data?.length) return;
  for (const recording of data) {
    await enqueueUnique(
      indexJobs,
      'index-segment',
      {
        recordingId: recording.id,
        tenantId: recording.tenant_id,
        restaurantId: recording.restaurant_id,
        cameraId: recording.camera_id,
        objectPath: recording.object_key,
        startedAt: recording.started_at,
        endedAt: recording.ended_at,
      },
      recording.id,
    );
  }
}

async function reconcileStaleVideoJobs() {
  const staleBefore = new Date(Date.now() - config.STALE_JOB_MS).toISOString();
  const { data, error } = await db
    .from('reels')
    .select(
      'id,tenant_id,restaurant_id,moment_id,status,updated_at,metadata,moments(occurred_at,window_start,window_end)',
    )
    .in('status', [...IN_FLIGHT_REEL_STATUSES])
    .lt('updated_at', staleBefore)
    .limit(20);
  if (error) {
    log.warn({ err: error.message }, 'stale reel query failed');
    return;
  }
  if (!data?.length) return;
  const inflight = await videoJobs.getJobs(['active', 'waiting', 'delayed', 'paused'], 0, 200);
  const activeReels = new Set<string>();
  for (const job of inflight) {
    const reelId = (job.data as { reelId?: string } | undefined)?.reelId;
    if (!reelId) continue;
    const state = await job.getState();
    const hasLock = Boolean(await redis.exists(`bull:${QUEUES.video}:${job.id}:lock`));
    if (isLiveQueueJob({ state, hasLock })) {
      activeReels.add(reelId);
      continue;
    }
    if (state === 'active' && !hasLock) {
      log.warn({ reel_id: reelId, jobId: job.id }, 'stale active video job without lock');
    }
  }
  for (const row of data ?? []) {
    const reel = row as unknown as StaleReel & {
      moments?: StaleReel['moments'] | StaleReel['moments'][];
    };
    const moment = Array.isArray(reel.moments) ? reel.moments[0] : reel.moments;
    const recoveryCount = recoveryCountFromMetadata(reel.metadata);
    const action = planStaleRecovery({
      status: reel.status,
      updatedAt: reel.updated_at,
      now: Date.now(),
      staleMs: config.STALE_JOB_MS,
      hasActiveJob: activeReels.has(reel.id),
      recoveryCount,
      maxRecoveries: config.MAX_JOB_RECOVERIES,
    });
    if (action === 'skip') continue;
    if (!moment) continue;
    const programRaw = (reel.metadata as { program?: string } | null)?.program;
    const program = editPrograms.includes(programRaw as (typeof editPrograms)[number])
      ? (programRaw as (typeof editPrograms)[number])
      : 'assinatura';
    if (action === 'fail') {
      await setStatus(reel.tenant_id, reel.id, 'failed', 0, 'Job interrompido sem recuperação', {
        error_code: 'STALE_JOB',
        error_message: 'STALE_JOB:max_recoveries',
      });
      log.warn({ reel_id: reel.id, recoveryCount }, 'stale job failed after recovery cap');
      continue;
    }
    const nextCount = recoveryCount + 1;
    await setStatus(reel.tenant_id, reel.id, 'queued', 5, 'Recuperando job interrompido', {
      error_code: 'STALE_JOB',
      error_message: 'STALE_JOB:requeued',
      metadata: {
        ...(reel.metadata ?? {}),
        program,
        recovery_count: nextCount,
        recovery_reason: 'STALE_JOB',
      },
    });
    const queued = await enqueueUnique(
      videoJobs,
      'render-reel',
      {
        jobId: reel.id,
        tenantId: reel.tenant_id,
        restaurantId: reel.restaurant_id,
        momentId: reel.moment_id,
        reelId: reel.id,
        occurredAt: new Date(moment.occurred_at).toISOString(),
        windowStart: new Date(moment.window_start).toISOString(),
        windowEnd: new Date(moment.window_end).toISOString(),
        program,
      },
      `${reel.id}-recover-${nextCount}`,
    );
    log.warn({ reel_id: reel.id, recoveryCount: nextCount, queued }, 'stale job requeued');
  }
}

async function sweepDailyDigests() {
  const { data, error } = await db.from('restaurants').select('id,tenant_id,timezone,settings');
  if (error || !data?.length) return;
  const now = new Date();
  for (const restaurant of data) {
    const timezone = restaurant.timezone || 'America/Sao_Paulo';
    const settings = (restaurant.settings ?? {}) as Record<string, unknown>;
    const digestHour = Number(settings.digest_hour ?? 21);
    if (clockHour(now, timezone) !== digestHour) continue;
    const day = calendarDay(now, timezone);
    await enqueueUnique(
      digestJobs,
      'daily-digest',
      {
        tenantId: restaurant.tenant_id,
        restaurantId: restaurant.id,
        day,
      },
      `digest:${restaurant.id}:${day}`,
    );
  }
}

let heartbeatInFlight = false;

async function heartbeat() {
  if (heartbeatInFlight) return;
  heartbeatInFlight = true;
  const now = new Date().toISOString();
  try {
    const { error } = await db.from('worker_nodes').upsert({
      id: workerId,
      last_seen_at: now,
      metadata: {
        hostname: hostname(),
        video: videoConcurrency,
        index: config.INDEX_WORKER_CONCURRENCY,
        highlight: config.HIGHLIGHT_WORKER_CONCURRENCY,
        render: config.RENDER_WORKER_CONCURRENCY,
        ffmpegThreads: config.FFMPEG_THREADS,
        renderProfile: config.RENDER_PROFILE,
        gemini: Boolean(config.GEMINI_API_KEY),
        geminiBlocked: runtimeStatus.geminiBlocked,
        openai: Boolean(config.OPENAI_API_KEY),
        visionProvider: configuredVisionKind(),
        visionModel:
          configuredVisionKind() === 'openai'
            ? config.OPENAI_MODEL
            : configuredVisionKind() === 'gemini'
              ? config.GEMINI_MODEL
              : 'none',
        vision_real: isRealVisionProvider(configuredVisionKind()),
        visionCredential: configuredVisionKind() === 'heuristic' ? 'missing' : 'configured',
        rawLifecycle: runtimeStatus.rawLifecycle,
      },
    });
    if (error) throw new Error(error.message);
    await writeFile(path.join(config.WORK_DIR, 'worker-alive'), now, 'utf8');
  } finally {
    heartbeatInFlight = false;
  }
}

async function cleanupStaleWork() {
  let entries;
  try {
    entries = await readdir(config.WORK_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!/^(job-|index-|hl-)/.test(entry.name)) continue;
    const full = path.join(config.WORK_DIR, entry.name);
    try {
      await rm(full, { recursive: true, force: true });
      log.info({ path: entry.name }, 'stale work dir removed');
    } catch {
      // ignore races with an in-flight job on restart overlap
    }
  }
}

video.on('completed', (job) =>
  log.info(
    {
      jobId: job.id,
      reel_id: (job.data as { reelId?: string })?.reelId,
      program: (job.data as { program?: string })?.program,
    },
    'video completed',
  ),
);
video.on('failed', (job, error) =>
  log.error(
    {
      jobId: job?.id,
      reel_id: (job?.data as { reelId?: string } | undefined)?.reelId,
      error: error.message,
    },
    'video failed',
  ),
);
index.on('completed', (job) => log.info({ jobId: job.id }, 'index completed'));
index.on('failed', (job, error) =>
  log.error({ jobId: job?.id, error: error.message }, 'index failed'),
);
highlight.on('completed', (job) => log.info({ jobId: job.id }, 'highlight completed'));
highlight.on('failed', (job, error) =>
  log.error({ jobId: job?.id, error: error.message }, 'highlight failed'),
);
digest.on('completed', (job) => log.info({ jobId: job.id }, 'digest completed'));
digest.on('failed', (job, error) =>
  log.error({ jobId: job?.id, error: error.message }, 'digest failed'),
);
publishing.on('completed', (job) => log.info({ jobId: job.id }, 'publication completed'));
publishing.on('failed', (job, error) =>
  log.error({ jobId: job?.id, error: error.message }, 'publishing failed'),
);

await heartbeat();
await sweepPendingRecordings().catch((error) => log.warn({ error }, 'pending index sweep skipped'));
await sweepDailyDigests().catch((error) => log.warn({ error }, 'daily digest sweep skipped'));
await reconcileStaleVideoJobs().catch((error) =>
  log.warn({ error }, 'stale video job reconcile skipped'),
);
const heartbeatTimer = setInterval(
  () => void heartbeat().catch((error) => log.error({ error }, 'heartbeat failed')),
  30_000,
);
const sweepTimer = setInterval(() => {
  void sweepPendingRecordings().catch((error) => log.warn({ error }, 'pending index sweep failed'));
  void sweepDailyDigests().catch((error) => log.warn({ error }, 'daily digest sweep failed'));
  void reconcileStaleVideoJobs().catch((error) =>
    log.warn({ error }, 'stale video job reconcile failed'),
  );
}, 60_000);

async function shutdown() {
  clearInterval(heartbeatTimer);
  clearInterval(sweepTimer);
  log.info('shutting down');
  await Promise.all([
    video.close(),
    index.close(),
    highlight.close(),
    digest.close(),
    publishing.close(),
  ]);
  await db.from('worker_nodes').delete().eq('id', workerId);
  await redis.quit();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
const visionKind = configuredVisionKind();
log.info(
  {
    VisionProvider: visionKind,
    VisionModel:
      visionKind === 'openai'
        ? config.OPENAI_MODEL
        : visionKind === 'gemini'
          ? config.GEMINI_MODEL
          : 'none',
    vision_real: isRealVisionProvider(visionKind),
    Credential: visionKind === 'heuristic' ? 'missing' : 'configured',
    requireRealVision: config.REQUIRE_REAL_VISION,
    storageScanFallback: config.ALLOW_STORAGE_SCAN_FALLBACK,
    videoConcurrency,
    renderProfile: config.RENDER_PROFILE,
    ffmpegThreads: config.FFMPEG_THREADS,
    rawLifecycle: runtimeStatus.rawLifecycle,
    workerId,
  },
  'workers ready',
);
