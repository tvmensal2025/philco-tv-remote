import {
  HIGHLIGHT_CLIP_SECONDS,
  HIGHLIGHT_FUSE_MS,
  highlightBucketMs,
  highlightJobSchema,
  indexJobSchema,
  type IndexJob,
} from '@reelops/shared';
import type { Job } from 'bullmq';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { config } from '../config.js';
import { db, log } from '../services.js';
import { downloadObject } from './media.js';
import { scanSegment } from './ffmpeg.js';
import { enqueueUnique, highlightJobs } from '../queues.js';

export async function processIndex(job: Job<IndexJob>) {
  const payload = indexJobSchema.parse(job.data);
  const { data: recording, error } = await db
    .from('recordings')
    .select(
      'id,tenant_id,restaurant_id,camera_id,object_key,started_at,ended_at,duration_seconds,index_status',
    )
    .eq('id', payload.recordingId)
    .eq('tenant_id', payload.tenantId)
    .single();
  if (error || !recording) throw new Error('INVALID_INDEX_RECORDING');
  if (recording.index_status === 'indexed') return { skipped: true };

  await db
    .from('recordings')
    .update({ index_status: 'indexing', index_error: null })
    .eq('id', recording.id)
    .eq('tenant_id', payload.tenantId);
  await mkdir(config.WORK_DIR, { recursive: true });
  const dir = await mkdtemp(path.join(config.WORK_DIR, 'index-'));
  try {
    const local = path.join(dir, 'segment.mp4');
    await downloadObject(recording.object_key, local);
    const duration = Number(recording.duration_seconds ?? config.NVR_SEGMENT_SECONDS);
    const peaks = await scanSegment(local, duration);
    const startedAt = Date.parse(recording.started_at);

    if (peaks.length) {
      const rows = peaks.map((peak) => {
        const absStart = new Date(startedAt + peak.offsetSeconds * 1000);
        return {
          tenant_id: payload.tenantId,
          restaurant_id: payload.restaurantId,
          camera_id: payload.cameraId,
          recording_id: recording.id,
          started_at: absStart.toISOString(),
          ended_at: new Date(absStart.getTime() + peak.durationSeconds * 1000).toISOString(),
          offset_seconds: peak.offsetSeconds,
          duration_seconds: peak.durationSeconds,
          offset_bucket: Math.round(peak.offsetSeconds),
          scene_score: peak.sceneScore,
          audio_lufs: peak.audioLufs,
          silence_ratio: peak.silenceRatio,
          fused_score: peak.fusedScore,
          source: peak.source,
          status: 'detected',
          metadata: { jobId: job.id },
        };
      });
      const { error: insertError } = await db
        .from('highlight_candidates')
        .upsert(rows, { onConflict: 'recording_id,offset_bucket', ignoreDuplicates: true });
      if (insertError) throw insertError;
    }

    await db
      .from('recordings')
      .update({ index_status: 'indexed', indexed_at: new Date().toISOString(), index_error: null })
      .eq('id', recording.id)
      .eq('tenant_id', payload.tenantId);

    for (const peak of peaks) {
      await maybeEnqueueHighlight(
        payload.tenantId,
        payload.restaurantId,
        startedAt + peak.offsetSeconds * 1000,
        peak.fusedScore,
      );
    }
    return { peaks: peaks.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INDEX_FAILED';
    await db
      .from('recordings')
      .update({ index_status: 'failed', index_error: message.slice(0, 400) })
      .eq('id', recording.id)
      .eq('tenant_id', payload.tenantId);
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function maybeEnqueueHighlight(
  tenantId: string,
  restaurantId: string,
  occurredAtMs: number,
  score: number,
) {
  const windowStart = new Date(occurredAtMs - HIGHLIGHT_FUSE_MS);
  const windowEnd = new Date(occurredAtMs + HIGHLIGHT_FUSE_MS);
  const { data: nearby } = await db
    .from('highlight_candidates')
    .select('id,camera_id,fused_score,started_at')
    .eq('tenant_id', tenantId)
    .eq('restaurant_id', restaurantId)
    .gte('started_at', windowStart.toISOString())
    .lte('started_at', windowEnd.toISOString())
    .in('status', ['detected', 'fused']);

  const cameras = new Set((nearby ?? []).map((row) => row.camera_id));
  const best = Math.max(score, ...(nearby ?? []).map((row) => Number(row.fused_score ?? 0)));
  if (cameras.size < 2 && best < 60) return false;

  const ids = (nearby ?? []).map((row) => row.id);
  if (ids.length) {
    await db
      .from('highlight_candidates')
      .update({ status: 'fused', camera_count: cameras.size, fused_score: best })
      .eq('tenant_id', tenantId)
      .in('id', ids);
  }

  const bucketMs = highlightBucketMs(occurredAtMs);
  const payload = highlightJobSchema.parse({
    tenantId,
    restaurantId,
    occurredAt: new Date(occurredAtMs).toISOString(),
    windowStart: new Date(occurredAtMs - (HIGHLIGHT_CLIP_SECONDS / 2) * 1000).toISOString(),
    windowEnd: new Date(occurredAtMs + (HIGHLIGHT_CLIP_SECONDS / 2) * 1000).toISOString(),
    bucketMs,
  });
  const enqueued = await enqueueUnique(
    highlightJobs,
    'analyze-highlight',
    payload,
    `hl:${restaurantId}:${bucketMs}`,
    { delay: 8_000 },
  );
  if (enqueued)
    log.info({ restaurantId, bucketMs, cameras: cameras.size, best }, 'highlight fused');
  return enqueued;
}
