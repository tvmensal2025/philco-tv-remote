import { DelayedError, Worker } from 'bullmq';
import { calendarDay, clockHour, editPrograms, jitterBackoffMs, QUEUES } from '@reelops/shared';
import { randomUUID } from 'node:crypto';
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
import { isYoloConfigured, probeYoloHealth } from './adapters/yolo.js';
import { digestJobs, enqueueUnique, indexJobs } from './queues.js';
import { runtimeStatus } from './runtime-status.js';
import { isRealVisionProvider } from './adapters/vision-provider.js';
import {
  classifyQueueHealth,
  IN_FLIGHT_REEL_STATUSES,
  isStaleWorkerHeartbeat,
  lastProgressAtIso,
  ownerWorkerId,
  planStaleRecovery,
  recoveryCountFromMetadata,
  videoJobId,
  type StaleReel,
} from './engine/job-recovery.js';
import {
  acquireRecoveryLease,
  getVideoQueueSnapshot,
  reclaimOrRetryVideoJob,
} from './engine/reclaim-video-job.js';
import { setStatus } from './pipeline/status.js';
import { workerId } from './worker-id.js';
import { workerDescriptor } from './engine/worker-descriptor.js';
import {
  freeTenantRenderSlot,
  redisCounterStore,
  takeTenantRenderSlot,
} from './engine/tenant-slots.js';
import { bootstrapStorage } from './storage-lifecycle.js';
import { SUPABASE_FETCH_TIMEOUT_MS, withTimeout } from './supabase-fetch.js';

await bootstrapStorage({
  minio,
  bucket: config.MINIO_BUCKET,
  retentionDays: config.RAW_RETENTION_DAYS,
  log,
});
await mkdir(config.WORK_DIR, { recursive: true });
await cleanupStaleWork();
const videoConcurrency = Math.min(
  config.VIDEO_WORKER_CONCURRENCY,
  config.RENDER_WORKER_CONCURRENCY,
  2,
);

const tenantSlots = redisCounterStore(redis);
const video = new Worker(
  QUEUES.video,
  async (job, token) => {
    const tenantId = (job.data as { tenantId?: string } | undefined)?.tenantId;
    if (typeof tenantId !== 'string') return processVideo(job);
    let held = false;
    try {
      const slot = await takeTenantRenderSlot(
        tenantSlots,
        tenantId,
        config.MAX_RENDER_JOBS_PER_TENANT,
      );
      if (!slot.ok) {
        await job.moveToDelayed(
          Date.now() +
            jitterBackoffMs(
              0,
              config.TENANT_FAIRNESS_DELAY_MS,
              config.TENANT_FAIRNESS_DELAY_MS * 2,
            ),
          token,
        );
        throw new DelayedError();
      }
      held = true;
      return await processVideo(job);
    } catch (error) {
      if (error instanceof DelayedError) throw error;
      const slotError =
        error instanceof Error && /ECONNREFUSED|ETIMEDOUT|READONLY/i.test(error.message);
      if (!held && slotError) return processVideo(job);
      throw error;
    } finally {
      if (held) await freeTenantRenderSlot(tenantSlots, tenantId).catch(() => undefined);
    }
  },
  {
    connection: redis.duplicate(),
    concurrency: videoConcurrency,
    lockDuration: 15 * 60 * 1000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
);
const index = new Worker(QUEUES.index, processIndex, {
  connection: redis.duplicate(),
  concurrency: config.INDEX_WORKER_CONCURRENCY,
  lockDuration: 5 * 60 * 1000,
});
const highlight = new Worker(QUEUES.highlight, processHighlight, {
  connection: redis.duplicate(),
  concurrency: config.HIGHLIGHT_WORKER_CONCURRENCY,
  lockDuration: 8 * 60 * 1000,
  limiter: { max: 12, duration: 60_000 },
});
const digest = new Worker(QUEUES.digest, processDigest, {
  connection: redis.duplicate(),
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
  { connection: redis.duplicate(), concurrency: 1, lockDuration: 10 * 60 * 1000 },
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
  const { data, error } = await db
    .from('reels')
    .select(
      'id,tenant_id,restaurant_id,moment_id,status,updated_at,metadata,moments(occurred_at,window_start,window_end)',
    )
    .in('status', [...IN_FLIGHT_REEL_STATUSES])
    .limit(40);
  if (error) {
    log.warn({ err: error.message }, 'stale reel query failed');
    return;
  }
  if (!data?.length) return;

  const now = Date.now();
  const ownerIds = [
    ...new Set(
      data
        .map((row) => ownerWorkerId((row.metadata as Record<string, unknown> | null) ?? {}))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const heartbeatByWorker = new Map<string, string | null>();
  if (ownerIds.length) {
    const { data: nodes } = await db
      .from('worker_nodes')
      .select('id,last_seen_at')
      .in('id', ownerIds);
    for (const node of nodes ?? []) {
      heartbeatByWorker.set(node.id, (node.last_seen_at as string | null) ?? null);
    }
  }

  for (const row of data) {
    const reel = row as unknown as StaleReel & {
      moments?: StaleReel['moments'] | StaleReel['moments'][];
    };
    const moment = Array.isArray(reel.moments) ? reel.moments[0] : reel.moments;
    const metadata = (reel.metadata ?? {}) as Record<string, unknown>;
    const recoveryCount = recoveryCountFromMetadata(metadata);
    const ownerId = ownerWorkerId(metadata);
    const ownerWorkerFresh = !isStaleWorkerHeartbeat({
      lastSeenAt: ownerId ? (heartbeatByWorker.get(ownerId) ?? null) : null,
      now,
      staleMs: config.WORKER_HEARTBEAT_STALE_MS,
    });
    const snapshot = await getVideoQueueSnapshot(reel.id);
    const queueHealth = classifyQueueHealth({
      state: snapshot.state,
      hasLock: snapshot.hasLock,
      ownerWorkerFresh,
    });
    const action = planStaleRecovery({
      status: reel.status,
      lastProgressAt: lastProgressAtIso(metadata, reel.updated_at),
      now,
      staleMs: config.STALE_JOB_MS,
      queueHealth,
      recoveryCount,
      maxRecoveries: config.MAX_JOB_RECOVERIES,
    });
    if (action === 'skip') continue;
    if (!moment) continue;
    const programRaw = metadata.program;
    const program = editPrograms.includes(programRaw as (typeof editPrograms)[number])
      ? (programRaw as (typeof editPrograms)[number])
      : 'assinatura';
    if (action === 'fail') {
      await setStatus(reel.tenant_id, reel.id, 'failed', 0, 'Job interrompido sem recuperação', {
        error_code: 'STALE_JOB',
        error_message: 'STALE_JOB:max_recoveries',
      });
      log.warn(
        { reel_id: reel.id, recoveryCount, queueHealth },
        'stale job failed after recovery cap',
      );
      continue;
    }
    if (action !== 'reclaim' && action !== 'requeue') continue;
    const leased = await acquireRecoveryLease(reel.id);
    if (!leased) {
      log.info({ reel_id: reel.id, queueHealth, action }, 'recovery lease held by another worker');
      continue;
    }
    const nextCount = recoveryCount + 1;
    const reclaimToken = randomUUID();
    await setStatus(reel.tenant_id, reel.id, 'queued', 5, 'Recuperando job interrompido', {
      error_code: 'STALE_JOB',
      error_message: 'STALE_JOB:requeued',
      metadata: {
        ...metadata,
        program,
        recovery_count: nextCount,
        recovery_reason: 'STALE_JOB',
        recovery_action: action,
        logical_job_id: videoJobId(reel.id),
        execution_id: `reclaim:${reclaimToken}`,
        owner_worker_id: null,
        stale_detected_at: new Date().toISOString(),
      },
    });
    const result = await reclaimOrRetryVideoJob({
      reelId: reel.id,
      action,
      payload: {
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
    });
    log.warn(
      {
        reel_id: reel.id,
        logical_job_id: videoJobId(reel.id),
        recoveryCount: nextCount,
        queueHealth,
        action,
        method: result.method,
        jobId: result.jobId,
        ok: result.ok,
      },
      'stale job recovered',
    );
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
let heartbeatCount = 0;

async function heartbeat() {
  if (heartbeatInFlight) return;
  heartbeatInFlight = true;
  heartbeatCount += 1;
  const now = new Date().toISOString();
  const descriptor = workerDescriptor();
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);
  try {
    const result = (await withTimeout(
      db
        .from('worker_nodes')
        .upsert({
          id: workerId,
          last_seen_at: now,
          metadata: {
            ...descriptor,
            heartbeatAt: now,
            hostname: descriptor.hostname,
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
            yolo: runtimeStatus.yolo,
          },
        })
        .abortSignal(controller.signal),
      SUPABASE_FETCH_TIMEOUT_MS,
      'heartbeat upsert',
    )) as { error: { message: string } | null };
    if (result.error) throw new Error(result.error.message);
    if (isYoloConfigured() && heartbeatCount % 2 === 1) {
      const yolo = await probeYoloHealth();
      runtimeStatus.yolo = {
        ok: yolo.ok,
        loaded: yolo.loaded,
        device: yolo.device,
        reason: yolo.reason ?? (yolo.ok ? 'ok' : 'unhealthy'),
      };
    }
    await writeFile(path.join(config.WORK_DIR, 'worker-alive'), now, 'utf8');
    if (heartbeatCount % 5 === 0) {
      const memory = process.memoryUsage();
      log.info(
        { workerId, rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external },
        'worker memory',
      );
    }
    if (heartbeatCount % 20 === 0) {
      const cutoff = new Date(Date.now() - config.WORKER_NODE_TTL_HOURS * 3_600_000).toISOString();
      await db.from('worker_nodes').delete().lt('last_seen_at', cutoff).neq('id', workerId);
    }
    log.info({ workerId, environment: descriptor.environment }, 'heartbeat ok');
  } finally {
    clearTimeout(abortTimer);
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
log.info({ workerId }, 'heartbeat loop started');
const heartbeatTimer = setInterval(
  () => void heartbeat().catch((error) => log.error({ error }, 'heartbeat failed')),
  30_000,
);
const sweepTimer = setInterval(() => {
  void withTimeout(sweepPendingRecordings(), 20_000, 'pending index sweep').catch((error) =>
    log.warn({ error }, 'pending index sweep failed'),
  );
  void withTimeout(sweepDailyDigests(), 20_000, 'daily digest sweep').catch((error) =>
    log.warn({ error }, 'daily digest sweep failed'),
  );
  void withTimeout(reconcileStaleVideoJobs(), 20_000, 'stale video job reconcile').catch((error) =>
    log.warn({ error }, 'stale video job reconcile failed'),
  );
}, 60_000);
void withTimeout(sweepPendingRecordings(), 20_000, 'pending index sweep').catch((error) =>
  log.warn({ error }, 'pending index sweep skipped'),
);
void withTimeout(sweepDailyDigests(), 20_000, 'daily digest sweep').catch((error) =>
  log.warn({ error }, 'daily digest sweep skipped'),
);
void withTimeout(reconcileStaleVideoJobs(), 20_000, 'stale video job reconcile').catch((error) =>
  log.warn({ error }, 'stale video job reconcile skipped'),
);

async function shutdown() {
  clearInterval(heartbeatTimer);
  clearInterval(sweepTimer);
  log.info('shutting down');
  const force = setTimeout(() => {
    log.warn('shutdown timed out');
    process.exit(1);
  }, 25_000);
  force.unref();
  await Promise.all([
    video.close(),
    index.close(),
    highlight.close(),
    digest.close(),
    publishing.close(),
  ]);
  await db.from('worker_nodes').delete().eq('id', workerId);
  await redis.quit();
  clearTimeout(force);
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
