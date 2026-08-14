import { Queue, type JobsOptions } from 'bullmq';
import {
  QUEUES,
  type DigestJob,
  type HighlightJob,
  type IndexJob,
  type VideoJob,
} from '@reelops/shared';
import { redis } from './services.js';
import { isDuplicateJobError } from './job-identity.js';

export const videoJobs = new Queue<VideoJob, unknown, string>(QUEUES.video, { connection: redis });
export const indexJobs = new Queue<IndexJob, unknown, string>(QUEUES.index, { connection: redis });
export const highlightJobs = new Queue<HighlightJob, unknown, string>(QUEUES.highlight, {
  connection: redis,
});
export const digestJobs = new Queue<DigestJob, unknown, string>(QUEUES.digest, {
  connection: redis,
});

export const durableJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 8_000 },
  removeOnComplete: { age: 24 * 3600, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 8_000 },
};

export async function enqueueUnique(
  queue: Queue,
  name: string,
  data: object,
  jobId: string,
  extra: JobsOptions = {},
) {
  try {
    await queue.add(name, data, { jobId, ...durableJobOptions, ...extra });
    return true;
  } catch (error) {
    if (isDuplicateJobError(error)) return false;
    throw error;
  }
}
