import { NextResponse } from 'next/server';
import { resolveMomentSearchWindow } from '@reelops/shared';
import { adminClient } from '@/lib/supabase';
import { getServerEnv } from '@/lib/env';
import { enforceRateLimit } from '@/lib/rate-limit';
import { videoQueue } from '@/lib/queue';

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    if (request.headers.get('authorization') !== `Bearer ${env.INGEST_API_KEY}`) {
      return NextResponse.json({ error: 'Chave de ingestão inválida.' }, { status: 401 });
    }

    const input = await request.json();
    if (!input.cameraId || !input.startedAt || !input.endedAt || !input.source) {
      return NextResponse.json({ error: 'Parâmetros obrigatórios ausentes.' }, { status: 400 });
    }

    await enforceRateLimit(`ingest-motion:${input.cameraId}`, 30, 60);
    const admin = adminClient();
    const { data: camera } = await admin
      .from('cameras')
      .select('id,tenant_id,restaurant_id')
      .eq('id', input.cameraId)
      .eq('enabled', true)
      .single();
    if (!camera) return NextResponse.json({ error: 'Câmera não encontrada.' }, { status: 404 });

    const mergeGap = Number(process.env.MOTION_EVENT_MERGE_GAP_SECONDS ?? 8);
    const { data: recent } = await admin
      .from('motion_events')
      .select('id,ended_at')
      .eq('camera_id', camera.id)
      .order('ended_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const gapMs = Date.parse(input.startedAt) - Date.parse(String(recent?.ended_at ?? 0));
    let motion = recent;
    if (recent && Number.isFinite(gapMs) && gapMs >= 0 && gapMs <= mergeGap * 1000) {
      const { data: merged, error: mergeError } = await admin
        .from('motion_events')
        .update({ ended_at: input.endedAt, metadata: input.metadata || {} })
        .eq('id', recent.id)
        .select('id, ended_at')
        .single();
      if (mergeError) throw mergeError;
      motion = merged;
    } else {
      const inserted = await admin
        .from('motion_events')
        .insert({
          tenant_id: camera.tenant_id,
          restaurant_id: camera.restaurant_id,
          camera_id: camera.id,
          started_at: input.startedAt,
          ended_at: input.endedAt,
          source: input.source,
          motion_score: input.motionScore || null,
          metadata: input.metadata || {},
        })
        .select('id, ended_at')
        .single();
      if (inserted.error) throw inserted.error;
      motion = inserted.data;
    }

    const { data: restaurant } = await admin
      .from('restaurants')
      .select('settings')
      .eq('id', camera.restaurant_id)
      .single();
    const settings = (restaurant?.settings ?? {}) as Record<string, unknown>;
    if (!settings.auto_capture_motion) return NextResponse.json({ ok: true, queued: false });

    const occurredAt = new Date(input.endedAt);
    const pool = resolveMomentSearchWindow({
      durationSeconds: 60,
      beforeSeconds: Number(settings.window_before ?? 12),
      afterSeconds: Number(settings.window_after ?? 8),
    });
    const windowStart = new Date(occurredAt.getTime() - pool.beforeSeconds * 1000);
    const windowEnd = new Date(occurredAt.getTime() + pool.afterSeconds * 1000);

    const { data: moment, error: momentError } = await admin
      .from('moments')
      .insert({
        tenant_id: camera.tenant_id,
        restaurant_id: camera.restaurant_id,
        occurred_at: occurredAt.toISOString(),
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        label: 'Movimento detectado',
        type: 'motion',
      })
      .select()
      .single();
    if (momentError) throw momentError;

    const { data: reel, error: reelError } = await admin
      .from('reels')
      .insert({
        tenant_id: camera.tenant_id,
        restaurant_id: camera.restaurant_id,
        moment_id: moment.id,
        title: 'Movimento detectado',
        metadata: { program: 'casa', durationMode: 'ai', durationSeconds: null },
      })
      .select()
      .single();
    if (reelError) throw reelError;

    await videoQueue().add(
      'render-reel',
      {
        jobId: reel.id,
        tenantId: camera.tenant_id,
        restaurantId: camera.restaurant_id,
        momentId: moment.id,
        reelId: reel.id,
        occurredAt: occurredAt.toISOString(),
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        program: 'casa',
        durationMode: 'ai',
      },
      {
        jobId: reel.id,
        priority: 5,
        delay: Math.max(0, windowEnd.getTime() + 15_000 - Date.now()),
        attempts: 8,
        backoff: { type: 'exponential', delay: 10_000 },
      },
    );

    return NextResponse.json({ ok: true, queued: true, motionId: motion?.id, reelId: reel.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível confirmar o evento.' },
      { status: 400 },
    );
  }
}
