import { NextResponse } from 'next/server';
import { calendarDay, clockHour } from '@reelops/shared';
import { adminClient } from '@/lib/supabase';
import { getServerEnv } from '@/lib/env';
import { digestQueue } from '@/lib/queue';

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    const secret = env.CRON_SECRET ?? env.INGEST_API_KEY;
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      day?: string;
      restaurantId?: string;
      force?: boolean;
    };
    const admin = adminClient();
    let query = admin.from('restaurants').select('id,tenant_id,timezone,settings');
    if (body.restaurantId) query = query.eq('id', body.restaurantId);
    const { data: restaurants, error } = await query;
    if (error) throw error;

    const now = new Date();
    const queued: string[] = [];
    for (const restaurant of restaurants ?? []) {
      const timezone = restaurant.timezone || 'America/Sao_Paulo';
      const settings = (restaurant.settings ?? {}) as Record<string, unknown>;
      const digestHour = Number(settings.digest_hour ?? 21);
      const day =
        body.day && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : calendarDay(now, timezone);
      if (!body.force && !body.day && clockHour(now, timezone) !== digestHour) continue;
      try {
        await digestQueue().add(
          'daily-digest',
          {
            tenantId: restaurant.tenant_id,
            restaurantId: restaurant.id,
            day,
          },
          {
            jobId: `digest:${restaurant.id}:${day}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 8_000 },
            removeOnComplete: { age: 24 * 3600, count: 5_000 },
            removeOnFail: { age: 7 * 24 * 3600, count: 8_000 },
          },
        );
        queued.push(restaurant.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already exists|Job.*exists/i.test(message)) throw error;
      }
    }

    return NextResponse.json({ ok: true, queued: queued.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha no digest diário.' },
      { status: 400 },
    );
  }
}
