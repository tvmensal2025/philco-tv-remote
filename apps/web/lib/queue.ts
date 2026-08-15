import { Queue, type JobsOptions } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import {
  QUEUES,
  type DigestJob,
  type HighlightJob,
  type IndexJob,
  type VideoJob,
} from '@reelops/shared';
import { getServerEnv } from './env';

let connection: IORedis | undefined;
let queue: Queue<VideoJob> | undefined;
let publishQueue: Queue | undefined;
let indexQueueClient: Queue<IndexJob> | undefined;
let highlightQueueClient: Queue<HighlightJob> | undefined;
let digestQueueClient: Queue<DigestJob> | undefined;

function redisConnection() {
  const env = getServerEnv();
  connection ??= new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    connectTimeout: 2500,
  });
  return connection;
}

function resetRedisClients() {
  const old = connection;
  connection = undefined;
  queue = undefined;
  publishQueue = undefined;
  indexQueueClient = undefined;
  highlightQueueClient = undefined;
  digestQueueClient = undefined;
  if (old) {
    void old.quit().catch(() => {
      old.disconnect();
    });
  }
}

async function waitUntilReady(redis: IORedis, timeoutMs: number) {
  if (redis.status === 'ready') return;
  await Promise.race([
    (async () => {
      if (redis.status === 'wait' || redis.status === 'end' || redis.status === 'close') {
        await redis.connect();
      }
      if (redis.status === 'ready') return;
      await new Promise<void>((resolve, reject) => {
        if (redis.status === 'ready') {
          resolve();
          return;
        }
        const onReady = () => {
          redis.off('error', onError);
          resolve();
        };
        const onError = (error: Error) => {
          redis.off('ready', onReady);
          reject(error);
        };
        redis.once('ready', onReady);
        redis.once('error', onError);
      });
    })(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('QUEUE_UNAVAILABLE')), timeoutMs);
    }),
  ]);
}

async function pingRedis(redis: IORedis, timeoutMs: number) {
  await waitUntilReady(redis, timeoutMs);
  const result = await Promise.race([
    redis.ping(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('QUEUE_UNAVAILABLE')), timeoutMs);
    }),
  ]);
  if (result !== 'PONG') throw new Error('QUEUE_UNAVAILABLE');
}

export async function assertQueueAvailable(timeoutMs = 5000) {
  try {
    await pingRedis(redisConnection(), timeoutMs);
  } catch {
    resetRedisClients();
    try {
      await pingRedis(redisConnection(), timeoutMs);
    } catch {
      throw new Error('QUEUE_UNAVAILABLE');
    }
  }
}

export function videoQueue() {
  queue ??= new Queue<VideoJob>(QUEUES.video, { connection: redisConnection() });
  return queue;
}

export function publishingQueue() {
  publishQueue ??= new Queue(QUEUES.publishing, { connection: redisConnection() });
  return publishQueue;
}

export function indexQueue() {
  indexQueueClient ??= new Queue<IndexJob>(QUEUES.index, { connection: redisConnection() });
  return indexQueueClient;
}

export function highlightQueue() {
  highlightQueueClient ??= new Queue<HighlightJob>(QUEUES.highlight, {
    connection: redisConnection(),
  });
  return highlightQueueClient;
}

export function digestQueue() {
  digestQueueClient ??= new Queue<DigestJob>(QUEUES.digest, { connection: redisConnection() });
  return digestQueueClient;
}

export async function enqueueStableVideoJob(data: VideoJob, extra: JobsOptions = {}) {
  const queue = videoQueue();
  const jobId = data.reelId;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (
      state === 'waiting' ||
      state === 'delayed' ||
      state === 'active' ||
      state === 'prioritized'
    ) {
      return { ok: true as const, method: 'exists' as const, jobId };
    }
    try {
      await existing.remove();
    } catch {
      /* already consumed */
    }
  }
  await queue.add('render-reel', data, {
    jobId,
    attempts: 8,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
    ...extra,
  });
  return { ok: true as const, method: 'enqueue' as const, jobId };
}
