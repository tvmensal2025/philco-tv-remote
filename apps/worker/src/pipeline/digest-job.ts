import {
  dailyRankedReelPath,
  digestJobSchema,
  publicReelUrl,
  type DigestJob,
} from '@reelops/shared';
import type { Job } from 'bullmq';
import { config } from '../config.js';
import { db } from '../services.js';
import { copyObject, presignPublicGet } from './media.js';
import { sendWhatsApp } from '../adapters/wame.js';
import { pickTopReels, type DigestReel } from './digest-rank.js';

export async function processDigest(job: Job<DigestJob>) {
  const payload = digestJobSchema.parse(job.data);
  const { data: already } = await db
    .from('daily_digests')
    .select('id,status')
    .eq('restaurant_id', payload.restaurantId)
    .eq('day', payload.day)
    .maybeSingle();
  if (already?.status === 'sent') return { skipped: true, copied: 0, sent: true };

  const { data: restaurant, error } = await db
    .from('restaurants')
    .select('id,tenant_id,name,timezone,settings')
    .eq('id', payload.restaurantId)
    .eq('tenant_id', payload.tenantId)
    .single();
  if (error || !restaurant) throw new Error('DIGEST_RESTAURANT_NOT_FOUND');

  const timezone = restaurant.timezone || 'America/Sao_Paulo';
  const settings = (restaurant.settings ?? {}) as Record<string, unknown>;
  const whatsappDaily = settings.whatsapp_daily === true;
  const phone = String(settings.whatsapp_phone ?? '').replace(/\D/g, '');

  const { data: reels, error: reelError } = await db
    .from('reels')
    .select('id,title,caption,score,output_path,created_at,moments(occurred_at)')
    .eq('tenant_id', payload.tenantId)
    .eq('restaurant_id', payload.restaurantId)
    .in('status', ['ready', 'approved', 'published'])
    .not('output_path', 'is', null)
    .order('score', { ascending: false })
    .limit(40);
  if (reelError) throw reelError;

  const top = pickTopReels((reels ?? []) as DigestReel[], payload.day, timezone, 3);
  const { data: digest, error: upsertError } = await db
    .from('daily_digests')
    .upsert(
      {
        tenant_id: payload.tenantId,
        restaurant_id: payload.restaurantId,
        day: payload.day,
        reel_ids: top.map((reel) => reel.id),
        object_paths: [],
        status: top.length ? 'queued' : 'skipped',
        whatsapp_to: phone || null,
        error_message: top.length ? null : 'Nenhum Reel pronto neste dia',
      },
      { onConflict: 'restaurant_id,day' },
    )
    .select('id')
    .single();
  if (upsertError) throw upsertError;
  if (!top.length) return { skipped: true, copied: 0, sent: false };

  const objectPaths: string[] = [];
  for (const [index, reel] of top.entries()) {
    const dest = dailyRankedReelPath(
      payload.tenantId,
      payload.restaurantId,
      payload.day,
      index + 1,
      reel.id,
      reel.title ?? undefined,
    );
    await copyObject(reel.output_path!, dest);
    objectPaths.push(dest);
  }

  await db
    .from('daily_digests')
    .update({ object_paths: objectPaths, status: 'copied' })
    .eq('id', digest.id);

  if (!whatsappDaily) return { skipped: false, copied: objectPaths.length, sent: false };
  if (phone.length < 10) {
    await db
      .from('daily_digests')
      .update({
        status: 'copied',
        error_message: 'Reels organizados. Falta o WhatsApp do cliente (DDI + DDD).',
      })
      .eq('id', digest.id);
    return { skipped: true, copied: objectPaths.length, sent: false };
  }

  try {
    await sendWhatsApp({
      dest: phone,
      kind: 'text',
      text: `Os 3 destaques de ${payload.day} — ${restaurant.name}`,
    });

    for (const [index, reel] of top.entries()) {
      const videoUrl = await digestVideoUrl(reel.id, objectPaths[index]);
      await sendWhatsApp({
        dest: phone,
        kind: 'video',
        url: videoUrl,
        caption:
          `${index + 1}/3 ${reel.title || 'Destaque do dia'}${reel.caption ? `\n${reel.caption}` : ''}`.trim(),
      });
    }

    await db
      .from('daily_digests')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', digest.id);
    await db.from('activity_events').insert({
      tenant_id: payload.tenantId,
      restaurant_id: payload.restaurantId,
      event_type: 'digest.sent',
      entity_type: 'daily_digest',
      entity_id: digest.id,
      message: `3 Reels do dia ${payload.day} enviados no WhatsApp do cliente`,
      metadata: { reelIds: top.map((reel) => reel.id) },
    });
    return { skipped: false, copied: objectPaths.length, sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha no WhatsApp';
    await db
      .from('daily_digests')
      .update({ status: 'failed', error_message: message })
      .eq('id', digest.id);
    throw error;
  }
}

async function digestVideoUrl(reelId: string, objectPath: string) {
  if (config.APP_URL && config.INGEST_API_KEY && /^https:\/\//i.test(config.APP_URL)) {
    return publicReelUrl(config.APP_URL, reelId, config.INGEST_API_KEY);
  }
  if (config.MINIO_PUBLIC_ENDPOINT) {
    return presignPublicGet(objectPath, 12 * 60 * 60);
  }
  if (config.APP_URL && config.INGEST_API_KEY) {
    return publicReelUrl(config.APP_URL, reelId, config.INGEST_API_KEY);
  }
  throw new Error(
    'PUBLIC_VIDEO_URL_REQUIRED: o WhatsApp precisa de APP_URL em HTTPS ou MINIO_PUBLIC_ENDPOINT',
  );
}
