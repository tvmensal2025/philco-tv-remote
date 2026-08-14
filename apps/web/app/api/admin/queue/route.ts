import { NextResponse } from 'next/server';
import type { Queue } from 'bullmq';
import { videoQueue, indexQueue, highlightQueue } from '@/lib/queue';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { adminError } from '@/lib/admin-error';

async function snapshot(queue: Queue, name: string) {
  const counts = await queue.getJobCounts('wait', 'active', 'delayed', 'failed', 'completed');
  const jobs = await queue.getJobs(['wait', 'active', 'failed'], 0, 24);
  return {
    name,
    counts,
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
      snapshot(videoQueue(), 'video-pipeline'),
      snapshot(indexQueue(), 'segment-index'),
      snapshot(highlightQueue(), 'highlight-analyze'),
    ]);
    return NextResponse.json({ queues: [video, index, highlight] });
  } catch (error) {
    return adminError(error);
  }
}
