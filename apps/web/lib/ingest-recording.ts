import { rawSegmentPath } from '@reelops/shared';
import { adminClient } from '@/lib/supabase';
import { ensureStorage } from '@/lib/storage';
import { getServerEnv } from '@/lib/env';
import { MAX_INGEST_SECONDS } from '@/lib/ingest-video';

export { isAllowedVideo, mp4DurationSeconds, MAX_INGEST_SECONDS } from '@/lib/ingest-video';

export async function ingestRecordingBytes(input: {
  tenantId: string;
  restaurantId: string;
  cameraPosition: number;
  capturedAt: Date;
  durationSeconds: number;
  bytes: Buffer;
  contentType?: string;
}) {
  const env = getServerEnv();
  if (input.bytes.length > env.MAX_SEGMENT_BYTES) {
    throw new Error('Arquivo acima do limite permitido.');
  }
  const admin = adminClient();
  const { data: camera } = await admin
    .from('cameras')
    .select('id,tenant_id,restaurant_id,position,storage_prefix,enabled')
    .eq('tenant_id', input.tenantId)
    .eq('restaurant_id', input.restaurantId)
    .eq('position', input.cameraPosition)
    .eq('enabled', true)
    .single();
  if (!camera) throw new Error(`Câmera ${input.cameraPosition} não encontrada neste restaurante.`);

  const objectPath = rawSegmentPath(
    camera.tenant_id,
    camera.restaurant_id,
    camera.position,
    input.capturedAt,
  );
  const { storage, bucket } = await ensureStorage();
  await storage.putObject(bucket, objectPath, input.bytes, input.bytes.length, {
    'Content-Type': input.contentType || 'video/mp4',
  });

  const durationSeconds = Math.max(3, Math.min(MAX_INGEST_SECONDS, input.durationSeconds));
  const endedAt = new Date(input.capturedAt.getTime() + durationSeconds * 1000);
  const recordingRow = {
    tenant_id: camera.tenant_id,
    restaurant_id: camera.restaurant_id,
    camera_id: camera.id,
    object_key: objectPath,
    started_at: input.capturedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_seconds: durationSeconds,
    size_bytes: input.bytes.length,
    index_status: 'pending' as const,
  };
  const { data: recording, error: recordingError } = await admin
    .from('recordings')
    .upsert(recordingRow, { onConflict: 'object_key' })
    .select('id')
    .single();
  if (recordingError) throw recordingError;
  await admin
    .from('cameras')
    .update({ last_seen_at: input.capturedAt.toISOString(), last_segment_path: objectPath })
    .eq('id', camera.id)
    .eq('tenant_id', camera.tenant_id);

  try {
    const { indexQueue } = await import('@/lib/queue');
    if (recording?.id) {
      await indexQueue().add(
        'index-segment',
        {
          recordingId: recording.id,
          tenantId: camera.tenant_id,
          restaurantId: camera.restaurant_id,
          cameraId: camera.id,
          objectPath,
          startedAt: input.capturedAt.toISOString(),
          endedAt: endedAt.toISOString(),
        },
        {
          jobId: recording.id,
          attempts: 5,
          backoff: { type: 'exponential', delay: 8_000 },
          removeOnComplete: { age: 24 * 3600, count: 5_000 },
          removeOnFail: { age: 7 * 24 * 3600, count: 8_000 },
        },
      );
    }
  } catch {
    // Worker sweep requeues pending indexes.
  }

  return {
    ok: true as const,
    recordingId: recording?.id,
    cameraId: camera.id,
    objectPath,
    startedAt: input.capturedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds,
  };
}
