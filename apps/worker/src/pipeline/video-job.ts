import {
  adaptVideoEditDecisionV1ToV2,
  brandFromRestaurantSettings,
  calendarDay,
  classifyJobFailure,
  createRenderManifest,
  DIRECTOR_SCHEMA_VERSION_V2,
  evaluateCompositionQuality,
  evaluateTechnicalQuality,
  reelRenderPrefix,
  shouldRetryJob,
  videoEditDecisionV2ToV1,
  videoJobSchema,
  type VideoJob,
} from '@reelops/shared';
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import path from 'node:path';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { collectCameraClips, uploadOutput, uploadThumbnail } from './media.js';
import {
  configuredVisionKind,
  createAnalyzer,
  type EditDecision,
  type PlannedScene,
  type VisionFrame,
} from '../adapters/analyzer.js';
import { applyYoloCrops, isYoloConfigured } from '../adapters/yolo.js';
import {
  createVoiceProvider,
  isVoiceConfigured,
  voiceoverScript,
  type AudioAsset,
} from '../adapters/voice.js';
import { isRealVisionProvider } from '../adapters/vision-provider.js';
import { extractClip, extractJpegFrames, makeThumbnail, scanSegment } from './ffmpeg.js';
import { probeMedia } from './probe-media.js';
import { renderComposition } from './composition.js';
import { decisionFromReelPlan } from '../engine/director.js';
import { decideWithAiDirector } from '../engine/ai-director.js';
import {
  applyResolvedTimeline,
  directorCandidatesFromClips,
  resolveTimeline,
} from '../engine/scene-resolver.js';
import { casaCompositionLayout } from '../composition/design-system.js';
import { writeCaptionAss } from './captions.js';
import { runVisualQc } from './visual-qc.js';
import { setStatus } from './status.js';
import { config } from '../config.js';
import { db, log } from '../services.js';
import { ReelPlanner } from '../engine/planner.js';
import { loadPublishedPlaybook } from '../engine/program-presets.js';
import type { PeakHit } from '../engine/peak-snap.js';
import type { StyleName } from '../engine/rhythm.js';

export async function processVideo(job: Job<VideoJob>) {
  const payload = videoJobSchema.parse(job.data);
  const jobLog = {
    tenant_id: payload.tenantId,
    restaurant_id: payload.restaurantId,
    moment_id: payload.momentId,
    reel_id: payload.reelId,
    job_id: job.id,
    program: payload.program,
  };
  const authoritative = await verifyAuthoritativeData(payload);
  await mkdir(config.WORK_DIR, { recursive: true });
  const dir = await mkdtemp(path.join(config.WORK_DIR, 'job-'));
  const timings: Record<string, number> = {};
  try {
    await setStatus(
      payload.tenantId,
      payload.reelId,
      'collecting',
      10,
      'Buscando gravações C1–C4 no banco',
      { error_code: null, error_message: null },
    );
    const locateStarted = Date.now();
    const clips = await collectCameraClips(
      payload.tenantId,
      payload.restaurantId,
      payload.windowStart,
      payload.windowEnd,
      dir,
    );
    timings.recordingLocatorMs = Date.now() - locateStarted;
    if (!clips.length) throw new Error('MEDIA_NOT_READY:Nenhum conjunto de segmentos encontrado');
    log.info(
      {
        ...jobLog,
        cameras: clips.map((clip) => `C${clip.position}`),
        ms: timings.recordingLocatorMs,
      },
      'recording',
    );

    await setStatus(
      payload.tenantId,
      payload.reelId,
      'analyzing',
      28,
      'Extraindo frames das câmeras',
    );
    const frameStarted = Date.now();
    const framePaths: VisionFrame[] = [];
    const framesByCamera: Record<string, number> = {};
    for (const clip of clips) {
      const frameDir = path.join(dir, `frames-c${clip.position}`);
      try {
        const files = await extractJpegFrames(
          clip.localPath,
          frameDir,
          2,
          config.VISION_MAX_FRAMES,
        );
        framesByCamera[`C${clip.position}`] = files.length;
        framePaths.push(...files.map((file) => ({ cameraPosition: clip.position, path: file })));
      } catch (error) {
        framesByCamera[`C${clip.position}`] = 0;
        log.warn(
          { camera: clip.position, err: error instanceof Error ? error.message : String(error) },
          'frame extraction skipped',
        );
      }
    }
    timings.frameExtractionMs = Date.now() - frameStarted;
    log.info(
      { ...jobLog, framesByCamera, total: framePaths.length, ms: timings.frameExtractionMs },
      'frames extracted',
    );
    if (config.REQUIRE_REAL_VISION && !framePaths.length)
      throw new Error('FRAME_EXTRACTION_FAILED');

    const requestedDuration = Math.max(
      3,
      (Date.parse(payload.windowEnd) - Date.parse(payload.windowStart)) / 1000,
    );
    const stored = await loadStoredDecision(payload.momentId, payload.tenantId);
    if (config.REQUIRE_REAL_VISION && stored?.provider === 'heuristic') {
      throw new Error('VISION_PROVIDER_NOT_CONFIGURED');
    }
    let clipPath: string | undefined;
    if (!stored && !framePaths.length && config.GEMINI_API_KEY && clips[0]) {
      clipPath = path.join(dir, 'analyze.mp4');
      try {
        await extractClip(
          clips[0].localPath,
          clips[0].startOffsetSeconds,
          Math.min(12, requestedDuration),
          clipPath,
        );
      } catch {
        clipPath = undefined;
      }
    }
    const analyzer = createAnalyzer(authoritative.style, {
      clipPath,
      framePaths,
      prompt: authoritative.prompt,
    });
    const planner = new ReelPlanner(analyzer, {
      targetDuration: requestedDuration,
      style: authoritative.style,
      program: payload.program,
    });
    const visionKind = configuredVisionKind();
    await setStatus(
      payload.tenantId,
      payload.reelId,
      'analyzing',
      40,
      framePaths.length ? `Classificando câmeras com ${visionKind}` : `Montando ${payload.program}`,
    );
    const visionStarted = Date.now();
    const peaksByCamera = new Map<string, PeakHit[]>();
    await Promise.all(
      clips.map(async (clip) => {
        try {
          const duration = clip.windowDurationSeconds ?? requestedDuration;
          const peaks = await scanSegment(clip.localPath, duration, {
            maxPeaks: 8,
            fast: true,
            startSeconds: clip.startOffsetSeconds,
          });
          peaksByCamera.set(
            clip.cameraId,
            peaks.map((peak) => ({
              offsetSeconds: peak.offsetSeconds,
              fusedScore: peak.fusedScore,
            })),
          );
        } catch (error) {
          log.warn(
            { camera: clip.position, err: error instanceof Error ? error.message : String(error) },
            'peak scan skipped',
          );
          peaksByCamera.set(clip.cameraId, []);
        }
      }),
    );
    const plan = await planner.plan(clips, stored, {
      peaksByCamera,
      program: payload.program,
      playbook: await loadPublishedPlaybook(payload.program),
    });
    timings.geminiMs = Date.now() - visionStarted;
    timings.reelPlanningMs = timings.geminiMs;
    if (config.REQUIRE_REAL_VISION && !isRealVisionProvider(plan.provider))
      throw new Error('VISION_PROVIDER_NOT_CONFIGURED');
    log.info(
      {
        ...jobLog,
        provider: plan.provider,
        model: plan.model,
        vision_real: isRealVisionProvider(plan.provider),
        join: plan.join,
        scenes: plan.scenes.map((scene) => `C${scene.position}:${scene.role}:${scene.duration}s`),
        framesByCamera,
        frames: plan.framesAnalyzed ?? framePaths.length,
        analysisResolution: '480px-wide',
        rankings: plan.cameraRankings,
        ms: timings.geminiMs,
      },
      `vision`,
    );

    if (isYoloConfigured() && framePaths.length) {
      await setStatus(
        payload.tenantId,
        payload.reelId,
        'analyzing',
        48,
        'Enquadrando sujeito 9:16',
      );
      const yoloStarted = Date.now();
      const yolo = await applyYoloCrops({ scenes: plan.scenes, framePaths });
      timings.yoloMs = Date.now() - yoloStarted;
      log.info({ ...jobLog, ...yolo, ms: timings.yoloMs }, 'yolo crop');
    }

    await setStatus(payload.tenantId, payload.reelId, 'rendering', 55, 'Montando vídeo vertical');
    const output = path.join(dir, 'reel.mp4');
    const thumbnail = path.join(dir, 'thumbnail.jpg');
    const directorStarted = Date.now();
    const ids = {
      tenantId: payload.tenantId,
      restaurantId: payload.restaurantId,
      momentId: payload.momentId,
      reelId: payload.reelId,
    };
    let decision = decisionFromReelPlan(plan, ids, authoritative.brand);
    let decisionV2 = adaptVideoEditDecisionV1ToV2(decision);
    let directorRequested: 'ai_v2' | 'legacy' = config.ENABLE_AI_DIRECTOR ? 'ai_v2' : 'legacy';
    let directorUsed: 'ai_v2' | 'legacy' = 'legacy';
    let directorFallbackReason: string | null = null;
    let directorUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    let renderPlan = plan;
    let timelineSource: 'decision_v2' | 'legacy_plan' = 'legacy_plan';
    if (config.ENABLE_AI_DIRECTOR) {
      try {
        const ai = await decideWithAiDirector({
          plan,
          clips,
          ids,
          brand: authoritative.brand,
        });
        decisionV2 = ai.decision;
        decision = videoEditDecisionV2ToV1(ai.decision);
        const resolved = resolveTimeline(decisionV2, directorCandidatesFromClips(clips), plan);
        renderPlan = applyResolvedTimeline(plan, resolved);
        timelineSource = 'decision_v2';
        directorUsed = 'ai_v2';
        directorUsage = ai.usage;
        timings.directorMs = ai.latencyMs;
      } catch (error) {
        directorUsed = 'legacy';
        directorFallbackReason =
          error instanceof Error ? error.message.split(':')[0] : 'DIRECTOR_INVALID_OUTPUT';
        timings.directorMs = Date.now() - directorStarted;
        log.warn(
          {
            ...jobLog,
            err: error instanceof Error ? error.message : error,
            director_requested: directorRequested,
            director_used: directorUsed,
            director_fallback_reason: directorFallbackReason,
          },
          'ai director failed; using legacy adapter',
        );
        if (config.REQUIRE_AI_DIRECTOR) throw error;
      }
    } else {
      timings.directorMs = Date.now() - directorStarted;
    }
    const captions =
      renderPlan.caption && renderPlan.captionStrategy !== 'none'
        ? await writeCaptionAss(dir, renderPlan.caption, renderPlan.duration)
        : null;
    let voiceAsset: AudioAsset | null = null;
    const script = voiceoverScript({
      title: decision.text.title,
      subtitle: decision.text.subtitle,
      caption: renderPlan.caption,
    });
    if (isVoiceConfigured() && script) {
      try {
        await setStatus(payload.tenantId, payload.reelId, 'rendering', 52, 'Gerando narração');
        const voiceStarted = Date.now();
        voiceAsset = await createVoiceProvider().synthesize({
          text: script,
          voiceId: authoritative.brand.voiceId,
          tenantId: payload.tenantId,
          restaurantId: payload.restaurantId,
          outputDir: dir,
        });
        timings.elevenlabsMs = Date.now() - voiceStarted;
        decision = {
          ...decision,
          audio: {
            ...decision.audio,
            strategy: 'voiceover_plus_ambient',
            preserveAmbient: Boolean(renderPlan.audio),
            voiceGainDb: 0,
          },
        };
        decisionV2 = adaptVideoEditDecisionV1ToV2(decision);
        log.info(
          {
            ...jobLog,
            voice_provider: voiceAsset.provider,
            voice_id: voiceAsset.voiceId,
            voice_characters: voiceAsset.characters,
            voice_duration_ms: voiceAsset.durationMs,
            ms: timings.elevenlabsMs,
          },
          'elevenlabs',
        );
      } catch (error) {
        log.warn(
          { ...jobLog, err: error instanceof Error ? error.message : String(error) },
          'elevenlabs skipped; keeping original audio',
        );
      }
    }
    const renderStarted = Date.now();
    const requestedRenderer =
      config.ENABLE_REVIDEO && authoritative.enableRevideo && payload.program === 'casa'
        ? 'revideo'
        : 'ffmpeg';
    const render = await renderComposition(
      {
        plan: renderPlan,
        decision,
        output,
        captionsPath: captions,
        voicePath: voiceAsset?.path,
        workDir: dir,
      },
      requestedRenderer,
    );
    timings.ffmpegMs = Date.now() - renderStarted;
    timings.compositionMs = timings.ffmpegMs;
    if (render.timings) Object.assign(timings, render.timings);
    log.info(
      {
        ...jobLog,
        director_requested: directorRequested,
        director_used: directorUsed,
        director_fallback_reason: directorFallbackReason,
        timeline_source: timelineSource,
        render_profile_used: render.profile,
        render_warning: render.warning ?? null,
        composition_renderer_requested: render.requested,
        composition_renderer_used: render.renderer,
        composition_fallback_reason: render.fallbackReason ?? null,
        composition_strategy: render.strategy ?? null,
        voice_provider: voiceAsset?.provider ?? null,
        voice_duration_ms: voiceAsset?.durationMs ?? null,
        ffmpegMs: timings.ffmpegMs,
      },
      'render',
    );
    const bestFrame = pickBestFrame(framePaths, plan.cameraRankings, plan.bestFrames);
    if (bestFrame) await copyFile(bestFrame, thumbnail);
    else await makeThumbnail(output, thumbnail);

    await setStatus(payload.tenantId, payload.reelId, 'rendering', 82, 'Verificando qualidade');
    const probe = await probeMedia(output);
    const technical = evaluateTechnicalQuality(probe, {
      videoCodec: 'h264',
      pixFmt: 'yuv420p',
      requireAudio: Boolean(renderPlan.audio || voiceAsset),
    });
    if (technical.status !== 'passed') {
      throw new Error(`TECHNICAL_QC:${technical.issues.map((issue) => issue.code).join(',')}`);
    }
    const layout = render.renderer === 'revideo' ? casaCompositionLayout : null;
    const compositionQc = evaluateCompositionQuality({
      title: decision.text.enabled
        ? decision.text.title
        : layout
          ? (decision.text.title ?? 'Casa')
          : null,
      titleBox: layout?.titleBox,
      logoBox: layout?.logoBox,
      ctaBox: decision.text.cta ? layout?.ctaBox : null,
      showLogo: Boolean(layout),
      logoPresent: Boolean(layout),
      assetsLoaded: layout ? ['logo-fixture.png', 'revideo-branding'] : [],
      fontsLoaded: layout?.fonts,
      fixtureBranding: layout?.fixtureBranding,
      safeArea: layout?.safeArea,
    });
    if (compositionQc.status !== 'passed') {
      throw new Error(
        `COMPOSITION_QC:${compositionQc.issues.map((issue) => issue.code).join(',')}`,
      );
    }
    const visualQc = await runVisualQc();
    const actualDuration = probe.durationSeconds;
    const manifest = createRenderManifest({
      renderId: payload.reelId,
      template: plan.program,
      visionProvider: plan.provider,
      visionModel: plan.model,
      vision_real: isRealVisionProvider(plan.provider),
      directorSchemaVersion: directorUsed === 'ai_v2' ? DIRECTOR_SCHEMA_VERSION_V2 : undefined,
      compositionRenderer: render.renderer,
      compositionRendererRequested: render.requested,
      compositionFallbackReason: render.fallbackReason,
      renderProfileRequested: config.RENDER_PROFILE,
      renderProfileUsed: render.profile,
      renderFallbackReason: render.warning,
      sourceChecksums: [],
      startedAt: new Date(renderStarted).toISOString(),
      completedAt: new Date().toISOString(),
      quality: { technical, composition: compositionQc, visual: visualQc, status: 'passed' },
    });

    await setStatus(
      payload.tenantId,
      payload.reelId,
      'uploading',
      88,
      'Salvando Reel no armazenamento privado',
    );
    const uploadStarted = Date.now();
    const day = calendarDay(payload.windowStart, authoritative.timezone);
    const base = reelRenderPrefix(payload.tenantId, payload.restaurantId, day, payload.reelId);
    await uploadOutput(output, `${base}/reel.mp4`);
    await uploadThumbnail(thumbnail, `${base}/thumbnail.jpg`);
    timings.finalUploadMs = Date.now() - uploadStarted;
    await setStatus(payload.tenantId, payload.reelId, 'ready', 100, 'Reel pronto para revisão', {
      output_path: `${base}/reel.mp4`,
      thumbnail_path: `${base}/thumbnail.jpg`,
      duration_seconds: actualDuration,
      score: plan.score,
      caption: [plan.caption, ...(plan.hashtags ?? [])].filter(Boolean).join(' ') || null,
      metadata: {
        analysis: plan.reason,
        provider: plan.provider,
        model: plan.model,
        cameras: renderPlan.scenes.map((scene) => scene.camera_id),
        sourceAudio: Boolean(renderPlan.audio),
        program: plan.program,
        join: plan.join,
        detailedScores: plan.detailedScores,
        people_score: plan.peopleScore,
        story_score: plan.storyScore,
        confidence: plan.confidence,
        privacy_risk: plan.privacyRisk,
        recommended_use: plan.recommendedUse,
        camera_rankings: plan.cameraRankings,
        best_frames: plan.bestFrames,
        frames_by_camera: framesByCamera,
        frames_analyzed: plan.framesAnalyzed ?? framePaths.length,
        analysis_resolution: '480px-wide',
        timings,
        render_profile_requested: config.RENDER_PROFILE,
        render_profile_used: render.profile,
        render_warning: render.warning ?? null,
        render_fallback_reason: render.warning ?? null,
        vision_real: isRealVisionProvider(plan.provider),
        quality_status: 'passed',
        visual_qc: visualQc,
        video_edit_decision: decisionV2,
        render_manifest: manifest,
        director_requested: directorRequested,
        director_used: directorUsed,
        director_mode: directorUsed,
        director_usage: directorUsage ?? null,
        director_fallback_reason: directorFallbackReason,
        timeline_source: timelineSource,
        composition_renderer_requested: render.requested,
        composition_renderer_used: render.renderer,
        composition_fallback_reason: render.fallbackReason ?? null,
        composition_generations: render.generations ?? null,
        composition_strategy: render.strategy ?? null,
        voice_provider: voiceAsset?.provider ?? null,
        voice_duration_ms: voiceAsset?.durationMs ?? null,
        pipeline_version: config.VIDEO_PIPELINE_VERSION,
        scenes: renderPlan.scenes.map((scene) => ({
          cam: `C${scene.position}`,
          cameraId: scene.camera_id,
          recordingId: scene.recording_id ?? null,
          role: scene.role,
          desc: scene.reason,
          offset: scene.source_start_offset,
          duration: scene.duration,
          transition: scene.transition,
          punchIn: scene.punchIn,
          motion: scene.motion,
          crop: scene.crop ?? null,
        })),
      },
    });

    await db.from('activity_events').insert({
      tenant_id: payload.tenantId,
      restaurant_id: payload.restaurantId,
      event_type: 'reel.completed',
      entity_type: 'reel',
      entity_id: payload.reelId,
      message: 'Processamento concluído com sucesso',
      metadata: {
        score: plan.score,
        provider: plan.provider,
        model: plan.model,
        vision_real: isRealVisionProvider(plan.provider),
        render_profile_used: render.profile,
        render_warning: render.warning ?? null,
      },
    });
  } catch (error) {
    const attempts = Number(job.opts.attempts ?? 1);
    const finalAttempt = job.attemptsMade + 1 >= attempts;
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    const fatal = [
      'GEMINI_API_BLOCKED',
      'OPENAI_API_BLOCKED',
      'VISION_PROVIDER_NOT_CONFIGURED',
      'FRAME_EXTRACTION_FAILED',
      'SKIP_PROGRAM',
      'TECHNICAL_QC',
      'COMPOSITION_QC',
      'DIRECTOR_INVALID_OUTPUT',
      'DIRECTOR_INVALID_REFERENCE',
      'COMPOSITION_UNAVAILABLE',
    ].includes(message.split(':')[0]);
    const kind = classifyJobFailure(message);
    log.warn({ ...jobLog, err: message, fatal, finalAttempt, failure_class: kind }, 'reel failed');
    if (fatal || finalAttempt || !shouldRetryJob(kind)) {
      await setStatus(payload.tenantId, payload.reelId, 'failed', 0, 'Falha no processamento', {
        error_code: message.split(':')[0],
        error_message: message,
      });
    } else {
      await setStatus(
        payload.tenantId,
        payload.reelId,
        'queued',
        5,
        'Aguardando os segmentos completos do NVR',
        { error_code: null, error_message: null },
      );
    }
    if (fatal || !shouldRetryJob(kind)) throw new UnrecoverableError(message);
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function pickBestFrame(
  frames: VisionFrame[],
  rankings?: { cameraPosition: number; score: number }[],
  bestFrames?: { cameraPosition: number }[],
) {
  const preferred =
    bestFrames?.[0]?.cameraPosition ??
    [...(rankings ?? [])].sort((a, b) => b.score - a.score)[0]?.cameraPosition;
  if (!preferred) return frames[0]?.path;
  return frames.find((frame) => frame.cameraPosition === preferred)?.path ?? frames[0]?.path;
}

async function loadStoredDecision(
  momentId: string,
  tenantId: string,
): Promise<EditDecision | undefined> {
  const { data } = await db
    .from('highlight_scores')
    .select(
      'overall,reason,food,action,visual,marketing,ambience,caption_pt,hashtags,scenes,provider',
    )
    .eq('tenant_id', tenantId)
    .eq('moment_id', momentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return undefined;
  const scenes = Array.isArray(data.scenes) ? (data.scenes as PlannedScene[]) : [];
  return {
    clips: [],
    score: Number(data.overall ?? 0),
    reason: data.reason ?? 'Plano já analisado',
    detailedScores: {
      food: Number(data.food ?? 0),
      action: Number(data.action ?? 0),
      visual: Number(data.visual ?? 0),
      marketing: Number(data.marketing ?? 0),
      ambience: Number(data.ambience ?? 0),
    },
    scenes,
    captionPt: data.caption_pt ?? '',
    hashtags: data.hashtags ?? [],
    provider:
      data.provider === 'openai' ? 'openai' : data.provider === 'gemini' ? 'gemini' : 'heuristic',
  };
}

async function verifyAuthoritativeData(payload: VideoJob) {
  const { data: reel, error } = await db
    .from('reels')
    .select(
      'id,tenant_id,restaurant_id,moment_id,status,moments(occurred_at,window_start,window_end),restaurants(settings,timezone)',
    )
    .eq('id', payload.reelId)
    .eq('tenant_id', payload.tenantId)
    .single();
  if (error || !reel) throw new Error('INVALID_JOB_REEL');
  if (reel.restaurant_id !== payload.restaurantId || reel.moment_id !== payload.momentId)
    throw new Error('INVALID_JOB_SCOPE');
  if (['discarded', 'published'].includes(reel.status)) throw new Error('JOB_NOT_PROCESSABLE');
  const moment = reel.moments as unknown as {
    occurred_at: string;
    window_start: string;
    window_end: string;
  };
  if (
    Date.parse(moment.window_start) !== Date.parse(payload.windowStart) ||
    Date.parse(moment.window_end) !== Date.parse(payload.windowEnd) ||
    Date.parse(moment.occurred_at) !== Date.parse(payload.occurredAt)
  )
    throw new Error('STALE_JOB_PAYLOAD');
  const restaurant = reel.restaurants as unknown as {
    settings: Record<string, unknown>;
    timezone?: string;
  };
  const styleValue = String(restaurant.settings?.active_style ?? 'natural');
  const style: StyleName =
    styleValue === 'dynamic' || styleValue === 'cinematic' ? styleValue : 'natural';
  const brand = brandFromRestaurantSettings(restaurant.settings);
  const enableRevideo =
    restaurant.settings?.enableRevideo === true || restaurant.settings?.videoPipeline === 'v2';
  return {
    style,
    prompt:
      typeof restaurant.settings?.capture_prompt === 'string'
        ? restaurant.settings.capture_prompt
        : undefined,
    timezone: restaurant.timezone || 'America/Sao_Paulo',
    brand,
    enableRevideo,
  };
}
