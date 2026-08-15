import { NextResponse } from 'next/server';
import { requireContext, requireRole } from '@/lib/supabase';
import { getServerEnv } from '@/lib/env';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ingestRecordingBytes, isAllowedVideo } from '@/lib/ingest-recording';

export const runtime = 'nodejs';
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin', 'editor']);
    await enforceRateLimit(`bench-upload:${ctx.tenantId}:${ctx.user.id}`, 40, 60);
    const env = getServerEnv();
    const form = await request.formData();
    const file = form.get('file');
    const restaurantId = String(form.get('restaurantId') ?? '');
    const cameraPosition = Number(form.get('cameraPosition'));
    const capturedAt = new Date(String(form.get('capturedAt') ?? ''));
    const durationSeconds = Math.max(
      3,
      Math.min(3600, Number(form.get('durationSeconds') ?? env.NVR_SEGMENT_SECONDS)),
    );
    if (!(file instanceof File) || !isAllowedVideo(file))
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

    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await ingestRecordingBytes({
      tenantId: ctx.tenantId,
      restaurantId,
      cameraPosition,
      capturedAt,
      durationSeconds,
      bytes,
      contentType: file.type || 'video/mp4',
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha no upload.';
    const status =
      message === 'UNAUTHORIZED'
        ? 401
        : message === 'FORBIDDEN'
          ? 403
          : message === 'RATE_LIMITED'
            ? 429
            : message.includes('acima do limite')
              ? 413
              : 400;
    return NextResponse.json(
      { error: status === 403 ? 'Seu perfil não pode enviar gravações.' : message },
      { status },
    );
  }
}
