import { oldestWaitingAgeSeconds, queuePressure } from '@reelops/shared';
import { NextResponse } from 'next/server';
import type { Queue } from 'bullmq';
import { videoQueue, indexQueue, highlightQueue } from '@/lib/queue';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { adminError } from '@/lib/admin-error';

async function snapshot(queue: Queue, name: string, workerSlots = 1) {
  const counts = await queue.getJobCounts('wait', 'active', 'delayed', 'failed', 'completed');
  const waiting = await queue.getJobs(['wait', 'delayed'], 0, 24);
  const jobs = await queue.getJobs(['wait', 'active', 'failed'], 0, 24);
  const oldestAge = oldestWaitingAgeSeconds(waiting.map((job) => job.timestamp));
  return {
    name,
    counts,
    oldest_waiting_age_seconds: oldestAge,
    pressure: queuePressure({
      waiting: counts.wait ?? 0,
      active: counts.active ?? 0,
      oldestAgeSeconds: oldestAge,
      workerSlots,
    }),
    jobs: await Promise.all(
      jobs.map(async (job) => ({
        id: String(job.id),
        name: job.name,
        failedReason: job.failedReason?.slice(0, 240) ?? null,
        timestamp: job.timestamp,
        processedOn: job.processedOn ?? null,
        data: {
          tenantId: typeof job.data?.tenantId === 'string' ? job.data.tenantId : null,
          restaurantId: typeof job.data?.restaurantId === 'string' ? job.data.restaurantId : null,
          reelId: typeof job.data?.reelId === 'string' ? job.data.reelId : null,
          program: typeof job.data?.program === 'string' ? job.data.program : null,
        },
      })),
    ),
  };
}

export async function GET() {
  try {
    await requirePlatformAdmin();
    const [video, index, highlight] = await Promise.all([
      snapshot(videoQueue(), 'video-pipeline', 2),
      snapshot(indexQueue(), 'segment-index'),
      snapshot(highlightQueue(), 'highlight-analyze'),
    ]);
    return NextResponse.json({ queues: [video, index, highlight] });
  } catch (error) {
    return adminError(error);
  }
}
