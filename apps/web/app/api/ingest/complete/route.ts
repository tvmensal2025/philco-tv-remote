import { NextResponse } from 'next/server';
import {
  cameraStoragePrefix,
  decideIngestComplete,
  ingestCompleteSchema,
  recordingIdempotencyKey,
} from '@reelops/shared';
import { adminClient } from '@/lib/supabase';
import { ensureStorage } from '@/lib/storage';
import { getServerEnv } from '@/lib/env';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    if (request.headers.get('authorization') !== `Bearer ${env.INGEST_API_KEY}`)
      return NextResponse.json({ error: 'Chave de ingestão inválida.' }, { status: 401 });
    const input = ingestCompleteSchema.parse(await request.json());
    await enforceRateLimit(`ingest-complete:${input.cameraId}`, 30, 60);
    const admin = adminClient();
    const { data: camera } = await admin
      .from('cameras')
      .select('id,tenant_id,restaurant_id,position')
      .eq('id', input.cameraId)
      .eq('enabled', true)
      .single();
    if (!camera) return NextResponse.json({ error: 'Câmera não encontrada.' }, { status: 404 });
    const prefix = `${cameraStoragePrefix(camera.tenant_id, camera.restaurant_id, camera.position)}/`;
    if (!input.objectPath.startsWith(prefix))
      return NextResponse.json({ error: 'Caminho inválido.' }, { status: 403 });
    const { storage, bucket } = await ensureStorage();
    const stat = await storage.statObject(bucket, input.objectPath);
    if (!stat.size) return NextResponse.json({ error: 'Upload vazio.' }, { status: 409 });
    if (stat.size !== input.expectedBytes || stat.size > env.MAX_SEGMENT_BYTES) {
      await storage.removeObject(bucket, input.objectPath);
      return NextResponse.json(
        { error: 'Segmento inválido ou acima do limite permitido.' },
        { status: 413 },
      );
    }

    const startedAt = new Date(input.capturedAt);
    if (Number.isNaN(startedAt.getTime()))
      return NextResponse.json({ error: 'Timestamp inválido.' }, { status: 400 });
    const durationSeconds =
      input.durationSeconds ??
      (input.endedAt
        ? Math.max(1, (Date.parse(input.endedAt) - startedAt.getTime()) / 1000)
        : env.NVR_SEGMENT_SECONDS);
    const endedAt = input.endedAt
      ? new Date(input.endedAt)
      : new Date(startedAt.getTime() + durationSeconds * 1000);
    const idempotencyKey =
      input.idempotencyKey ??
      (input.checksum
        ? recordingIdempotencyKey({
            cameraId: camera.id,
            checksum: input.checksum,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
          })
        : undefined);

    if (idempotencyKey) {
      const { data: existing } = await admin
        .from('recordings')
        .select('id,object_key')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (existing?.id && decideIngestComplete(existing.id).action === 'reuse') {
        await admin
          .from('cameras')
          .update({ last_seen_at: startedAt.toISOString(), last_segment_path: existing.object_key })
          .eq('id', camera.id)
          .eq('tenant_id', camera.tenant_id);
        return NextResponse.json({
          ok: true,
          size: stat.size,
          recordingId: existing.id,
          duplicate: true,
        });
      }
    }

    const { error: cameraError } = await admin
      .from('cameras')
      .update({ last_seen_at: startedAt.toISOString(), last_segment_path: input.objectPath })
      .eq('id', camera.id)
      .eq('tenant_id', camera.tenant_id);
    if (cameraError) throw cameraError;

    const recordingRow: Record<string, unknown> = {
      tenant_id: camera.tenant_id,
      restaurant_id: camera.restaurant_id,
      camera_id: camera.id,
      object_key: input.objectPath,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      size_bytes: stat.size,
      index_status: 'pending' as const,
      ...(input.checksum ? { checksum: input.checksum } : {}),
      ...(input.timestampSource ? { timestamp_source: input.timestampSource } : {}),
      ...(input.timestampConfidence ? { timestamp_confidence: input.timestampConfidence } : {}),
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    };

    let recording = await upsertRecording(admin, recordingRow);
    if (
      recording.error &&
      /checksum|timestamp_source|timestamp_confidence|idempotency_key/i.test(
        recording.error.message,
      )
    ) {
      delete recordingRow.checksum;
      delete recordingRow.timestamp_source;
      delete recordingRow.timestamp_confidence;
      delete recordingRow.idempotency_key;
      recording = await upsertRecording(admin, recordingRow);
    }
    if (
      recording.error &&
      /duplicate key|unique/i.test(recording.error.message) &&
      idempotencyKey
    ) {
      const { data: existing } = await admin
        .from('recordings')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (existing?.id)
        return NextResponse.json({
          ok: true,
          size: stat.size,
          recordingId: existing.id,
          duplicate: true,
        });
    }
    if (recording.error) throw recording.error;

    try {
      const { indexQueue } = await import('@/lib/queue');
      if (recording.data?.id) {
        await indexQueue().add(
          'index-segment',
          {
            recordingId: recording.data.id,
            tenantId: camera.tenant_id,
            restaurantId: camera.restaurant_id,
            cameraId: camera.id,
            objectPath: input.objectPath,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
          },
          {
            jobId: recording.data.id,
            attempts: 5,
            backoff: { type: 'exponential', delay: 8_000 },
            removeOnComplete: { age: 24 * 3600, count: 5_000 },
            removeOnFail: { age: 7 * 24 * 3600, count: 8_000 },
          },
        );
      }
    } catch {
      // Segment is stored; the worker sweep requeues pending indexes.
    }

    return NextResponse.json({ ok: true, size: stat.size, recordingId: recording.data?.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível confirmar o upload.' },
      { status: 400 },
    );
  }
}

async function upsertRecording(
  admin: ReturnType<typeof adminClient>,
  recordingRow: Record<string, unknown>,
) {
  return admin
    .from('recordings')
    .upsert(recordingRow, { onConflict: 'object_key' })
    .select('id')
    .single();
}
