import { NextResponse } from 'next/server';
import { requireContext, requireRole } from '@/lib/supabase';
import { ingestRecordingBytes, isAllowedVideo, mp4DurationSeconds } from '@/lib/ingest-recording';
import { peekSharedClip, putSharedClip, takeSharedClip } from '@/lib/share-inbox';
import { getServerEnv } from '@/lib/env';
import { enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 180;

function redirectToEnviar(request: Request, shareId?: string) {
  const url = new URL('/enviar', request.url);
  if (shareId) url.searchParams.set('share', shareId);
  return NextResponse.redirect(url, 303);
}

export async function GET(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin', 'editor', 'viewer']);
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Compartilhamento inválido.' }, { status: 400 });
    const clip = peekSharedClip(id, ctx.tenantId);
    if (!clip)
      return NextResponse.json(
        { error: 'Esse envio expirou. Mande o vídeo de novo.' },
        { status: 404 },
      );
    return NextResponse.json(clip);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message === 'UNAUTHORIZED' ? 'Não autorizado.' : message },
      { status: message === 'UNAUTHORIZED' ? 401 : 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin', 'editor']);
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      await enforceRateLimit(`share-commit:${ctx.tenantId}:${ctx.user.id}`, 40, 60);
      const body = (await request.json()) as {
        shareId?: string;
        restaurantId?: string;
        cameraPosition?: number;
        capturedAt?: string;
        durationSeconds?: number;
      };
      const clip = body.shareId ? takeSharedClip(body.shareId, ctx.tenantId) : null;
      if (!clip) {
        return NextResponse.json(
          { error: 'Esse envio expirou. Mande o vídeo de novo.' },
          { status: 404 },
        );
      }
      const capturedAt = new Date(body.capturedAt ?? clip.lastModified ?? Date.now());
      const probed = mp4DurationSeconds(clip.bytes);
      const durationSeconds = Math.max(
        3,
        Math.min(3600, Number(body.durationSeconds) || probed || 45),
      );
      const result = await ingestRecordingBytes({
        tenantId: ctx.tenantId,
        restaurantId: String(body.restaurantId ?? ''),
        cameraPosition: Number(body.cameraPosition),
        capturedAt: Number.isNaN(capturedAt.getTime()) ? new Date(clip.lastModified) : capturedAt,
        durationSeconds,
        bytes: clip.bytes,
        contentType: clip.type,
      });
      return NextResponse.json(result);
    }

    const form = await request.formData();
    const files = form
      .getAll('file')
      .concat(form.getAll('files'))
      .filter((item): item is File => item instanceof File && isAllowedVideo(item));
    const first = files[0];
    if (!first) return redirectToEnviar(request);
    const env = getServerEnv();
    if (first.size > env.MAX_SEGMENT_BYTES) return redirectToEnviar(request);
    const shareId = putSharedClip({
      tenantId: ctx.tenantId,
      name: first.name || 'video.mp4',
      type: first.type || 'video/mp4',
      bytes: Buffer.from(await first.arrayBuffer()),
      lastModified: first.lastModified,
    });
    return redirectToEnviar(request, shareId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha no envio.';
    if (message === 'UNAUTHORIZED')
      return NextResponse.redirect(new URL('/login', request.url), 303);
    const status = message === 'FORBIDDEN' ? 403 : 400;
    return NextResponse.json(
      { error: status === 403 ? 'Seu perfil não pode enviar gravações.' : message },
      { status },
    );
  }
}
