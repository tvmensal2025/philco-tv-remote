import { NextResponse } from 'next/server';
import { editPrograms, parseVideoProject } from '@reelops/shared';
import { requireContext, requireRole, adminClient } from '@/lib/supabase';
import { assertQueueAvailable, enqueueStableVideoJob } from '@/lib/queue';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request, { params }: { params: Promise<{ reelId: string }> }) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin', 'editor']);
    await enforceRateLimit(`editor-export:${ctx.tenantId}:${ctx.user.id}`, 8, 60, {
      failClosed: true,
    });
    const { reelId } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = body.project ? parseVideoProject(body.project) : null;
    if (body.project && parsed && !parsed.success) {
      return NextResponse.json({ error: 'Projeto inválido.' }, { status: 400 });
    }
    const { data: reel } = await ctx.supabase
      .from('reels')
      .select('id,restaurant_id,moment_id,metadata,moments(occurred_at,window_start,window_end)')
      .eq('id', reelId)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (!reel) return NextResponse.json({ error: 'Reel não encontrado.' }, { status: 404 });
    const moment = Array.isArray(reel.moments) ? reel.moments[0] : reel.moments;
    if (!moment || !reel.restaurant_id || !reel.moment_id) {
      return NextResponse.json(
        { error: 'Este Reel não tem momento para renderizar.' },
        { status: 409 },
      );
    }
    const current =
      reel.metadata && typeof reel.metadata === 'object'
        ? (reel.metadata as Record<string, unknown>)
        : {};
    const project = parsed?.success
      ? {
          ...parsed.data,
          ai: {
            ...(parsed.data.ai ?? { mode: 'balanced' as const, decisions: [], unusedMediaIds: [] }),
            renderFromProject: true,
          },
        }
      : current.video_project;
    const programRaw = current.program;
    const program = editPrograms.includes(programRaw as (typeof editPrograms)[number])
      ? (programRaw as (typeof editPrograms)[number])
      : 'casa';
    const admin = adminClient();
    await admin
      .from('reels')
      .update({
        status: 'queued',
        progress: 0,
        error_message: null,
        metadata: { ...current, video_project: project, render_from_project: true },
      })
      .eq('id', reelId)
      .eq('tenant_id', ctx.tenantId);
    await assertQueueAvailable();
    await enqueueStableVideoJob({
      jobId: reelId,
      tenantId: ctx.tenantId,
      restaurantId: reel.restaurant_id,
      momentId: reel.moment_id,
      reelId,
      occurredAt: moment.occurred_at,
      windowStart: moment.window_start,
      windowEnd: moment.window_end,
      program,
    });
    return NextResponse.json({ ok: true, status: 'queued' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    const status =
      message === 'UNAUTHORIZED'
        ? 401
        : message === 'FORBIDDEN'
          ? 403
          : message === 'QUEUE_UNAVAILABLE'
            ? 503
            : 400;
    return NextResponse.json(
      { error: message === 'QUEUE_UNAVAILABLE' ? 'Fila de render indisponível.' : message },
      { status },
    );
  }
}
