import { NextResponse } from 'next/server';
import { decideMomentCreate, editProgramLabels, markMomentSchema } from '@reelops/shared';
import { requireContext, requireRole, adminClient } from '@/lib/supabase';
import { isAuthBypass } from '@/lib/env';
import { assertQueueAvailable, videoQueue } from '@/lib/queue';
import { enforceRateLimit } from '@/lib/rate-limit';
import { pickLatestCoverage } from '@/lib/latest-coverage';

export async function POST(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin', 'editor']);
    await enforceRateLimit(`moments:${ctx.tenantId}:${ctx.user.id}`, 10, 60, { failClosed: true });
    const input = markMomentSchema.parse(await request.json());
    const { data: restaurant } = await ctx.supabase
      .from('restaurants')
      .select('id,settings')
      .eq('id', input.restaurantId)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (!restaurant)
      return NextResponse.json({ error: 'Restaurante não encontrado.' }, { status: 404 });

    const settings = (restaurant.settings ?? {}) as Record<string, unknown>;
    const admin = adminClient();

    if (input.clientRequestId) {
      const { data: existing } = await admin
        .from('moments')
        .select('id,tenant_id,restaurant_id,occurred_at,window_start,window_end,label,category')
        .eq('tenant_id', ctx.tenantId)
        .eq('client_request_id', input.clientRequestId)
        .maybeSingle();
      if (existing && decideMomentCreate(existing.id).action === 'reuse') {
        const { data: reels } = await admin
          .from('reels')
          .select('id,status')
          .eq('moment_id', existing.id)
          .eq('tenant_id', ctx.tenantId);
        return NextResponse.json(
          { moment: existing, reels: reels ?? [], reel: reels?.[0], duplicate: true },
          { status: 200 },
        );
      }
    }

    let occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;
    let before = input.beforeSeconds ?? Number(settings.window_before ?? 12);
    let after = input.afterSeconds ?? Number(settings.window_after ?? 8);

    if (!occurredAt) {
      const { data: recordings } = await admin
        .from('recordings')
        .select('camera_id,started_at,ended_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('restaurant_id', input.restaurantId)
        .order('started_at', { ascending: false })
        .limit(120);
      const coverage = pickLatestCoverage(
        (recordings ?? []).map((row) => ({
          cameraId: row.camera_id,
          startedAt: row.started_at,
          endedAt: row.ended_at,
        })),
      );
      if (!coverage)
        return NextResponse.json(
          { error: 'Nenhuma gravação das câmeras para cortar.' },
          { status: 409 },
        );
      occurredAt = new Date(coverage.occurredAt);
      before = coverage.beforeSeconds;
      after = coverage.afterSeconds;
    }

    const windowStart = new Date(occurredAt.getTime() - before * 1000);
    const windowEnd = new Date(occurredAt.getTime() + after * 1000);

    try {
      await assertQueueAvailable();
    } catch {
      return NextResponse.json(
        { error: 'A fila está indisponível. O momento não foi criado.' },
        { status: 503 },
      );
    }

    const momentRow: Record<string, unknown> = {
      tenant_id: ctx.tenantId,
      restaurant_id: input.restaurantId,
      type: 'manual',
      created_by: isAuthBypass() ? null : ctx.user.id,
      occurred_at: occurredAt.toISOString(),
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      label: input.label,
      category: input.category ?? 'moment',
      priority_score: 100,
      ...(input.clientRequestId ? { client_request_id: input.clientRequestId } : {}),
    };

    let momentInsert = await admin.from('moments').insert(momentRow).select().single();
    if (
      momentInsert.error &&
      /client_request_id/i.test(momentInsert.error.message) &&
      input.clientRequestId
    ) {
      delete momentRow.client_request_id;
      momentInsert = await admin.from('moments').insert(momentRow).select().single();
    }
    if (
      momentInsert.error &&
      /duplicate key|unique/i.test(momentInsert.error.message) &&
      input.clientRequestId
    ) {
      const { data: existing } = await admin
        .from('moments')
        .select('id,tenant_id,restaurant_id,occurred_at,window_start,window_end,label,category')
        .eq('tenant_id', ctx.tenantId)
        .eq('client_request_id', input.clientRequestId)
        .maybeSingle();
      if (existing) {
        const { data: reels } = await admin
          .from('reels')
          .select('id,status')
          .eq('moment_id', existing.id)
          .eq('tenant_id', ctx.tenantId);
        return NextResponse.json(
          { moment: existing, reels: reels ?? [], reel: reels?.[0], duplicate: true },
          { status: 200 },
        );
      }
    }
    if (momentInsert.error) throw momentInsert.error;
    const moment = momentInsert.data;

    const created: { id: string }[] = [];
    try {
      const delay = Math.max(0, windowEnd.getTime() + 15_000 - Date.now());
      const program = 'casa' as const;
      const titleBase = input.label || 'Momento especial';
      const { data: reel, error: reelError } = await admin
        .from('reels')
        .insert({
          tenant_id: ctx.tenantId,
          restaurant_id: input.restaurantId,
          moment_id: moment.id,
          title: `${titleBase} · ${editProgramLabels[program]}`,
          metadata: { program },
        })
        .select()
        .single();
      if (reelError || !reel) throw reelError ?? new Error('REEL_INSERT');
      created.push(reel);
      await admin.from('job_events').insert({
        tenant_id: ctx.tenantId,
        reel_id: reel.id,
        status: 'queued',
        message: 'Casa',
      });
      await videoQueue().add(
        'render-reel',
        {
          jobId: reel.id,
          tenantId: ctx.tenantId,
          restaurantId: input.restaurantId,
          momentId: moment.id,
          reelId: reel.id,
          occurredAt: occurredAt.toISOString(),
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          program,
        },
        {
          jobId: reel.id,
          delay,
          priority: 1,
          attempts: 8,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
        },
      );
    } catch (queueError) {
      for (const reel of created) {
        await admin
          .from('reels')
          .update({
            status: 'failed',
            error_code: 'QUEUE_UNAVAILABLE',
            error_message: 'A fila está indisponível. Tente novamente.',
          })
          .eq('id', reel.id)
          .eq('tenant_id', ctx.tenantId);
      }
      if (!created.length)
        await admin.from('moments').delete().eq('id', moment.id).eq('tenant_id', ctx.tenantId);
      const unavailable = queueError instanceof Error && queueError.message === 'QUEUE_UNAVAILABLE';
      return NextResponse.json(
        { error: 'A fila está indisponível. O momento não entrou na renderização.' },
        { status: unavailable ? 503 : 400 },
      );
    }

    await admin.from('activity_events').insert({
      tenant_id: ctx.tenantId,
      restaurant_id: input.restaurantId,
      event_type: 'moment.created',
      entity_type: 'moment',
      entity_id: moment.id,
      message: 'Momento marcado',
      metadata: {
        source: input.occurredAt ? 'manual' : 'latest-coverage',
        programs: ['casa'],
        clientRequestId: input.clientRequestId ?? null,
      },
    });
    return NextResponse.json({ moment, reels: created, reel: created[0] }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno';
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
      { error: status === 403 ? 'Seu perfil não pode marcar momentos.' : message },
      { status },
    );
  }
}
