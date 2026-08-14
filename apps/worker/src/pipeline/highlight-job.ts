import {
  HIGHLIGHT_CLIP_SECONDS,
  defaultCameraRole,
  highlightJobSchema,
  type HighlightJob,
  type VideoJob,
} from '@reelops/shared';
import type { Job } from 'bullmq';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { config } from '../config.js';
import { db, log } from '../services.js';
import { downloadObject } from './media.js';
import { extractClip, extractJpegFrames } from './ffmpeg.js';
import {
  analyzeHighlightClip,
  configuredVisionKind,
  createAnalyzer,
  HeuristicAnalyzer,
  decisionFromGemini,
  type ClipCandidate,
  type VisionFrame,
} from '../adapters/analyzer.js';
import { enqueueUnique, videoJobs } from '../queues.js';
import type { StyleName } from '../engine/rhythm.js';

type Candidate = {
  id: string;
  camera_id: string;
  recording_id: string;
  started_at: string;
  offset_seconds: number;
  duration_seconds: number;
  fused_score: number;
  recordings?: { object_key: string } | { object_key: string }[] | null;
  cameras?: { position: number } | { position: number }[] | null;
};

export async function processHighlight(job: Job<HighlightJob>) {
  const payload = highlightJobSchema.parse(job.data);
  const { data: restaurant } = await db
    .from('restaurants')
    .select('id,settings,timezone')
    .eq('id', payload.restaurantId)
    .eq('tenant_id', payload.tenantId)
    .single();
  if (!restaurant) throw new Error('INVALID_HIGHLIGHT_RESTAURANT');
  const settings = (restaurant.settings ?? {}) as Record<string, unknown>;
  const style = normalizeStyle(settings.active_style);
  const minScore = Number(settings.highlight_min_score ?? config.HIGHLIGHT_MIN_SCORE);
  const dailyCap = Number(settings.max_auto_reels_per_day ?? config.HIGHLIGHT_DAILY_CAP);
  const autoCreate = settings.auto_highlights !== false;

  const { data: nearby } = await db
    .from('highlight_candidates')
    .select(
      'id,camera_id,recording_id,started_at,offset_seconds,duration_seconds,fused_score,recordings(object_key),cameras(position)',
    )
    .eq('tenant_id', payload.tenantId)
    .eq('restaurant_id', payload.restaurantId)
    .gte('started_at', payload.windowStart)
    .lte('started_at', payload.windowEnd)
    .order('fused_score', { ascending: false })
    .limit(8);

  const candidates = (nearby ?? []) as Candidate[];
  if (!candidates.length) return { skipped: 'no_candidates' };

  const duplicate = await existingMoment(
    payload.tenantId,
    payload.restaurantId,
    Date.parse(payload.occurredAt),
  );
  if (duplicate) {
    await markCandidates(
      payload.tenantId,
      candidates.map((item) => item.id),
      'rejected',
    );
    return { skipped: 'duplicate_window' };
  }

  if (await overDailyCap(payload.tenantId, payload.restaurantId, dailyCap)) {
    await markCandidates(
      payload.tenantId,
      candidates.map((item) => item.id),
      'quota',
    );
    return { skipped: 'daily_cap' };
  }

  const best = candidates[0];
  const objectKey = unwrap(best.recordings)?.object_key;
  const position = unwrap(best.cameras)?.position ?? 1;
  if (!objectKey) throw new Error('HIGHLIGHT_SOURCE_MISSING');

  await mkdir(config.WORK_DIR, { recursive: true });
  const dir = await mkdtemp(path.join(config.WORK_DIR, 'hl-'));
  try {
    const source = path.join(dir, 'source.mp4');
    const clip = path.join(dir, 'clip.mp4');
    await downloadObject(objectKey, source);
    const extractStart = Math.max(0, Number(best.offset_seconds));
    await extractClip(
      source,
      extractStart,
      Math.min(HIGHLIGHT_CLIP_SECONDS, Number(best.duration_seconds) || HIGHLIGHT_CLIP_SECONDS),
      clip,
    );

    const stubClips: ClipCandidate[] = candidates.map((item) => {
      const cameraPosition = unwrap(item.cameras)?.position ?? position;
      return {
        cameraId: item.camera_id,
        path: unwrap(item.recordings)?.object_key ?? '',
        localPath: clip,
        position: cameraPosition,
        startOffsetSeconds: 0,
        hasAudio: true,
        role: defaultCameraRole(cameraPosition),
      };
    });

    const visionKind = configuredVisionKind();
    let decision = config.REQUIRE_REAL_VISION
      ? null
      : await new HeuristicAnalyzer(style).analyze(stubClips);
    if (visionKind === 'heuristic') {
      if (config.REQUIRE_REAL_VISION) throw new Error('VISION_PROVIDER_NOT_CONFIGURED');
    } else if (visionKind === 'openai') {
      const frameDir = path.join(dir, 'hl-frames');
      const files = await extractJpegFrames(clip, frameDir, 2, 6);
      const framePaths: VisionFrame[] = files.map((file) => ({
        cameraPosition: position,
        path: file,
      }));
      log.info(
        { provider: 'openai', model: config.OPENAI_MODEL, frames: framePaths.length },
        'Vision provider: openai',
      );
      decision = await createAnalyzer(style, {
        framePaths,
        prompt: typeof settings.capture_prompt === 'string' ? settings.capture_prompt : undefined,
      }).analyze(stubClips);
    } else {
      log.info({ provider: 'gemini', model: config.GEMINI_MODEL }, 'Vision provider: gemini');
      const parsed = await analyzeHighlightClip({
        clipPath: clip,
        style,
        prompt: typeof settings.capture_prompt === 'string' ? settings.capture_prompt : undefined,
        cameras: stubClips.map((item) => item.position),
      });
      decision = decisionFromGemini(stubClips, parsed, style);
    }
    if (!decision) throw new Error('VISION_PROVIDER_NOT_CONFIGURED');

    const { error: scoreError } = await db.from('highlight_scores').insert({
      tenant_id: payload.tenantId,
      restaurant_id: payload.restaurantId,
      candidate_id: best.id,
      provider: decision.provider,
      food: decision.detailedScores.food,
      action: decision.detailedScores.action,
      visual: decision.detailedScores.visual,
      marketing: decision.detailedScores.marketing,
      ambience: decision.detailedScores.ambience,
      overall: decision.score,
      caption_pt: decision.captionPt,
      hashtags: decision.hashtags,
      scenes: decision.scenes,
      reason: decision.reason,
      raw: { style, cameras: stubClips.map((item) => item.position) },
    });
    if (scoreError) throw scoreError;

    await markCandidates(
      payload.tenantId,
      candidates.map((item) => item.id),
      'analyzed',
    );

    if (!autoCreate || decision.score < minScore) {
      return { analyzed: true, queued: false, score: decision.score };
    }

    const before = Number(settings.window_before ?? 12);
    const after = Number(settings.window_after ?? 8);
    const occurredAt = new Date(payload.occurredAt);
    const windowStart = new Date(occurredAt.getTime() - before * 1000);
    const windowEnd = new Date(occurredAt.getTime() + after * 1000);

    const { data: moment, error: momentError } = await db
      .from('moments')
      .insert({
        tenant_id: payload.tenantId,
        restaurant_id: payload.restaurantId,
        type: 'automatic',
        occurred_at: occurredAt.toISOString(),
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        label: decision.reason.slice(0, 80) || 'Destaque automático',
        priority_score: Math.round(decision.score),
      })
      .select('id')
      .single();
    if (momentError || !moment) throw momentError ?? new Error('MOMENT_INSERT');

    const { data: reel, error: reelError } = await db
      .from('reels')
      .insert({
        tenant_id: payload.tenantId,
        restaurant_id: payload.restaurantId,
        moment_id: moment.id,
        title: decision.captionPt?.slice(0, 80) || 'Destaque do turno',
        caption: [decision.captionPt, ...(decision.hashtags ?? [])].filter(Boolean).join(' '),
        score: decision.score,
        metadata: {
          program: 'assinatura',
          analysis: decision.reason,
          detailedScores: decision.detailedScores,
          provider: decision.provider,
          scenes: decision.scenes,
        },
      })
      .select('id')
      .single();
    if (reelError || !reel) throw reelError ?? new Error('REEL_INSERT');

    await db
      .from('highlight_scores')
      .update({ moment_id: moment.id })
      .eq('tenant_id', payload.tenantId)
      .eq('candidate_id', best.id);
    await markCandidates(
      payload.tenantId,
      candidates.map((item) => item.id),
      'accepted',
    );
    await db
      .from('job_events')
      .insert({
        tenant_id: payload.tenantId,
        reel_id: reel.id,
        status: 'queued',
        message: 'Destaque automático enfileirado',
      });
    await db.from('activity_events').insert({
      tenant_id: payload.tenantId,
      restaurant_id: payload.restaurantId,
      event_type: 'highlight.accepted',
      entity_type: 'moment',
      entity_id: moment.id,
      message: 'IA encontrou um destaque no turno',
      metadata: { score: decision.score, provider: decision.provider },
    });

    const videoPayload: VideoJob = {
      jobId: reel.id,
      tenantId: payload.tenantId,
      restaurantId: payload.restaurantId,
      momentId: moment.id,
      reelId: reel.id,
      occurredAt: occurredAt.toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      program: 'assinatura',
    };
    await enqueueUnique(videoJobs, 'render-reel', videoPayload, reel.id, {
      delay: Math.max(0, windowEnd.getTime() + 15_000 - Date.now()),
      attempts: 8,
    });
    return { analyzed: true, queued: true, reelId: reel.id, score: decision.score };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function existingMoment(tenantId: string, restaurantId: string, occurredAtMs: number) {
  const { data } = await db
    .from('moments')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('restaurant_id', restaurantId)
    .eq('type', 'automatic')
    .gte('occurred_at', new Date(occurredAtMs - 8_000).toISOString())
    .lte('occurred_at', new Date(occurredAtMs + 8_000).toISOString())
    .limit(1);
  return data?.[0]?.id;
}

async function overDailyCap(tenantId: string, restaurantId: string, cap: number) {
  if (cap <= 0) return true;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await db
    .from('moments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('restaurant_id', restaurantId)
    .eq('type', 'automatic')
    .gte('created_at', start.toISOString());
  return (count ?? 0) >= cap;
}

async function markCandidates(tenantId: string, ids: string[], status: string) {
  if (!ids.length) return;
  await db.from('highlight_candidates').update({ status }).eq('tenant_id', tenantId).in('id', ids);
}

function unwrap<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function normalizeStyle(value: unknown): StyleName {
  return value === 'dynamic' || value === 'cinematic' ? value : 'natural';
}
