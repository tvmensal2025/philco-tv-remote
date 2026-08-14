import { NextResponse } from 'next/server';
import { cameraStoragePrefix, rawSegmentPath } from '@reelops/shared';
import { adminClient, requireContext, requireRole } from '@/lib/supabase';
import { ensureStorage } from '@/lib/storage';
import { getServerEnv } from '@/lib/env';
import { enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin', 'editor']);
    await enforceRateLimit(`bench-upload:${ctx.tenantId}:${ctx.user.id}`, 20, 60);
    const env = getServerEnv();
    const form = await request.formData();
    const file = form.get('file');
    const restaurantId = String(form.get('restaurantId') ?? '');
    const cameraPosition = Number(form.get('cameraPosition'));
    const capturedAt = new Date(String(form.get('capturedAt') ?? ''));
    const durationSeconds = Math.max(
      3,
      Math.min(600, Number(form.get('durationSeconds') ?? env.NVR_SEGMENT_SECONDS)),
    );
    if (!(file instanceof File) || file.size < 10_000)
      return NextResponse.json({ error: 'Envie um vídeo válido.' }, { status: 400 });
    if (file.size > env.MAX_SEGMENT_BYTES)
      return NextResponse.json({ error: 'Arquivo acima do limite permitido.' }, { status: 413 });
    if (
      !restaurantId ||
      !Number.isInteger(cameraPosition) ||
      cameraPosition < 1 ||
      cameraPosition > 16
    ) {
      return NextResponse.json({ error: 'Câmera inválida.' }, { status: 400 });
    }
    if (Number.isNaN(capturedAt.getTime()))
      return NextResponse.json({ error: 'Timestamp inválido.' }, { status: 400 });

    const admin = adminClient();
    const { data: camera } = await admin
      .from('cameras')
      .select('id,tenant_id,restaurant_id,position,storage_prefix,enabled')
      .eq('tenant_id', ctx.tenantId)
      .eq('restaurant_id', restaurantId)
      .eq('position', cameraPosition)
      .eq('enabled', true)
      .single();
    if (!camera)
      return NextResponse.json(
        { error: `Câmera ${cameraPosition} não encontrada neste restaurante.` },
        { status: 404 },
      );

    const objectPath = rawSegmentPath(
      camera.tenant_id,
      camera.restaurant_id,
      camera.position,
      capturedAt,
    );
    const { storage, bucket } = await ensureStorage();
    const bytes = Buffer.from(await file.arrayBuffer());
    await storage.putObject(bucket, objectPath, bytes, bytes.length, {
      'Content-Type': 'video/mp4',
    });

    const endedAt = new Date(capturedAt.getTime() + durationSeconds * 1000);
    const recordingRow = {
      tenant_id: camera.tenant_id,
      restaurant_id: camera.restaurant_id,
      camera_id: camera.id,
      object_key: objectPath,
      started_at: capturedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      size_bytes: bytes.length,
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
      .update({ last_seen_at: capturedAt.toISOString(), last_segment_path: objectPath })
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
            startedAt: capturedAt.toISOString(),
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

    return NextResponse.json({
      ok: true,
      recordingId: recording?.id,
      cameraId: camera.id,
      objectPath,
      startedAt: capturedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSeconds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha no upload.';
    const status =
      message === 'UNAUTHORIZED'
        ? 401
        : message === 'FORBIDDEN'
          ? 403
          : message === 'RATE_LIMITED'
            ? 429
            : 400;
    return NextResponse.json(
      { error: status === 403 ? 'Seu perfil não pode enviar gravações.' : message },
      { status },
    );
  }
}
