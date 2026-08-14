import { NextResponse } from 'next/server';
import { editPrograms, reelActionSchema } from '@reelops/shared';
import { requireContext, requireRole, adminClient } from '@/lib/supabase';
import { assertQueueAvailable, videoQueue } from '@/lib/queue';
import { publishingQueue } from '@/lib/queue';
import { hasInstagramPublisher, isAuthBypass } from '@/lib/env';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin', 'editor']);
    await enforceRateLimit(`reel-actions:${ctx.tenantId}:${ctx.user.id}`, 30, 60);
    const { id } = await params;
    const input = reelActionSchema.parse(await request.json());
    const { data: reel } = await ctx.supabase
      .from('reels')
      .select('*, moments(occurred_at,window_start,window_end)')
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (!reel) return NextResponse.json({ error: 'Reel não encontrado.' }, { status: 404 });

    const admin = adminClient();
    if (input.action === 'publish') {
      if (!hasInstagramPublisher())
        return NextResponse.json(
          { error: 'Preencha as credenciais da Meta em Configurações ou use Exportar MP4.' },
          { status: 409 },
        );
      if (reel.status !== 'approved')
        return NextResponse.json({ error: 'Aprove o Reel antes de publicar.' }, { status: 409 });
      const { data: existing } = await admin
        .from('publications')
        .select('id,status')
        .eq('reel_id', id)
        .eq('provider', 'instagram')
        .in('status', ['queued', 'publishing', 'published'])
        .maybeSingle();
      if (existing)
        return NextResponse.json(
          { error: 'Este Reel já foi enviado para publicação.' },
          { status: 409 },
        );
      const { data: publication, error: publicationError } = await admin
        .from('publications')
        .insert({ tenant_id: ctx.tenantId, reel_id: id, provider: 'instagram', status: 'queued' })
        .select()
        .single();
      if (publicationError) throw publicationError;
      try {
        await publishingQueue().add(
          'publish-instagram',
          {
            publicationId: publication.id,
            reelId: id,
            tenantId: ctx.tenantId,
            provider: 'instagram',
          },
          {
            jobId: publication.id,
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        );
      } catch (queueError) {
        await admin
          .from('publications')
          .update({ status: 'failed', error_message: 'Fila de publicação indisponível' })
          .eq('id', publication.id)
          .eq('tenant_id', ctx.tenantId);
        throw queueError;
      }
      await admin
        .from('reels')
        .update({ status: 'publishing' })
        .eq('id', id)
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'approved');
      return NextResponse.json({ ok: true });
    }
    if (input.action === 'approve') {
      if (reel.status !== 'ready')
        return NextResponse.json(
          { error: 'Somente Reels prontos podem ser aprovados.' },
          { status: 409 },
        );
      const { error } = await admin
        .from('reels')
        .update({
          status: 'approved',
          approved_by: isAuthBypass() ? null : ctx.user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'ready');
      if (error) throw error;
      await admin
        .from('activity_events')
        .insert({
          tenant_id: ctx.tenantId,
          restaurant_id: reel.restaurant_id,
          event_type: 'reel.approved',
          entity_type: 'reel',
          entity_id: id,
          message: 'Reel aprovado',
        });
    }
    if (input.action === 'discard') {
      if (!['ready', 'approved', 'failed'].includes(reel.status))
        return NextResponse.json(
          { error: 'Este Reel ainda está em processamento.' },
          { status: 409 },
        );
      const { error } = await admin
        .from('reels')
        .update({ status: 'discarded' })
        .eq('id', id)
        .eq('tenant_id', ctx.tenantId);
      if (error) throw error;
      await admin
        .from('activity_events')
        .insert({
          tenant_id: ctx.tenantId,
          restaurant_id: reel.restaurant_id,
          event_type: 'reel.discarded',
          entity_type: 'reel',
          entity_id: id,
          message: 'Reel descartado',
        });
    }
    if (input.action === 'retry') {
      if (reel.status !== 'failed')
        return NextResponse.json(
          { error: 'Somente jobs com falha podem ser reenviados.' },
          { status: 409 },
        );
      const moment = reel.moments as {
        occurred_at: string;
        window_start: string;
        window_end: string;
      };
      const metadata = (reel.metadata ?? {}) as { program?: string };
      const program = editPrograms.includes(metadata.program as (typeof editPrograms)[number])
        ? (metadata.program as (typeof editPrograms)[number])
        : ('assinatura' as const);
      await assertQueueAvailable();
      await videoQueue().add(
        'render-reel',
        {
          jobId: reel.id,
          tenantId: reel.tenant_id,
          restaurantId: reel.restaurant_id,
          momentId: reel.moment_id,
          reelId: reel.id,
          occurredAt: new Date(moment.occurred_at).toISOString(),
          windowStart: new Date(moment.window_start).toISOString(),
          windowEnd: new Date(moment.window_end).toISOString(),
          program,
        },
        {
          jobId: `${reel.id}-retry-${Date.now()}`,
          attempts: 8,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );
      const { error } = await admin
        .from('reels')
        .update({ status: 'queued', progress: 0, error_code: null, error_message: null })
        .eq('id', id)
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'failed');
      if (error) throw error;
      await admin
        .from('activity_events')
        .insert({
          tenant_id: ctx.tenantId,
          restaurant_id: reel.restaurant_id,
          event_type: 'reel.queued',
          entity_type: 'reel',
          entity_id: id,
          message: 'Reprocessamento solicitado',
        });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    const status =
      message === 'UNAUTHORIZED'
        ? 401
        : message === 'FORBIDDEN'
          ? 403
          : message === 'RATE_LIMITED'
            ? 429
            : message === 'QUEUE_UNAVAILABLE'
              ? 503
              : 400;
    return NextResponse.json(
      { error: status === 403 ? 'Seu perfil não permite esta ação.' : message },
      { status },
    );
  }
}
