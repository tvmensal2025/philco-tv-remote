/**
 * Reclaim a zombie BullMQ video job using the official lock token API.
 * Reads `bull:{queue}:{id}:lock` only to pass the token into `moveToFailed`.
 * Does not DEL the lock key. Always reuses jobId === reelId.
 */
import type { Job } from 'bullmq';
import { QUEUES, type VideoJob } from '@reelops/shared';
import { redis, log } from '../services.js';
import { enqueueUnique, videoJobs } from '../queues.js';
import { isDuplicateJobError } from '../job-identity.js';
import { videoJobId } from './job-recovery.js';
import { workerId } from '../worker-id.js';

const RECOVER_LEASE_PREFIX = 'cenapronta:video-recover:';

export async function acquireRecoveryLease(reelId: string, ttlSec = 60) {
  const key = `${RECOVER_LEASE_PREFIX}${reelId}`;
  const ok = await redis.set(key, workerId, 'EX', ttlSec, 'NX');
  return ok === 'OK';
}

export async function lockTokenForJob(jobId: string) {
  const token = await redis.get(`bull:${QUEUES.video}:${jobId}:lock`);
  return token || null;
}

export async function getVideoQueueSnapshot(reelId: string) {
  const jobId = videoJobId(reelId);
  const job = (await videoJobs.getJob(jobId)) as Job<VideoJob> | undefined;
  const state = job ? await job.getState() : null;
  const hasLock = Boolean(job && (await lockTokenForJob(String(job.id))));
  return { job, state, hasLock, jobId };
}

export async function reclaimOrRetryVideoJob(input: {
  reelId: string;
  payload: VideoJob;
  action: 'reclaim' | 'requeue';
}) {
  const jobId = videoJobId(input.reelId);
  const job = await videoJobs.getJob(jobId);
  if (input.action === 'reclaim' && job) {
    const state = await job.getState();
    const token = await lockTokenForJob(String(job.id));
    if (state === 'active' && token) {
      try {
        await job.moveToFailed(new Error('STALE_WORKER'), token, true);
      } catch (error) {
        log.warn(
          {
            reel_id: input.reelId,
            jobId,
            err: error instanceof Error ? error.message : String(error),
          },
          'moveToFailed for stale lock skipped',
        );
      }
    }
    const after = await job.getState();
    if (after === 'failed' || after === 'completed') {
      try {
        await job.retry();
        return { ok: true, method: 'retry' as const, jobId };
      } catch (error) {
        log.warn(
          {
            reel_id: input.reelId,
            jobId,
            err: error instanceof Error ? error.message : String(error),
          },
          'job.retry failed; removing and re-adding same id',
        );
        try {
          await job.remove();
        } catch {
          /* already gone */
        }
      }
    }
  }
  if (job && (await job.getState()) === 'waiting') {
    return { ok: true, method: 'already_waiting' as const, jobId };
  }
  if (job && (await job.getState()) === 'active') {
    return { ok: false, method: 'still_active' as const, jobId };
  }
  try {
    if (job) await job.remove().catch(() => undefined);
    await enqueueUnique(videoJobs, 'render-reel', input.payload, jobId);
    return { ok: true, method: 'enqueue' as const, jobId };
  } catch (error) {
    if (isDuplicateJobError(error)) return { ok: true, method: 'exists' as const, jobId };
    throw error;
  }
}
