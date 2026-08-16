import {
  adaptVideoEditDecisionV1ToV2,
  brandFromRestaurantSettings,
  calendarDay,
  classifyJobFailure,
  createRenderManifest,
  defaultBrandingFor,
  DIRECTOR_SCHEMA_VERSION_V2,
  evaluateCompositionQuality,
  evaluateTechnicalQuality,
  groundedCaption,
  programBrandCopy,
  reelRenderPrefix,
  shouldRetryJob,
  videoEditDecisionV2ToV1,
  videoJobSchema,
  canPromoteFinalOutput,
  executionObjectKeys,
  parseVideoProject,
  compileVideoProject,
  projectFromDecision,
  lockScenesToLiveSubject,
  type VideoJob,
} from '@reelops/shared';
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import {
  collectCameraClips,
  copyObject,
  downloadObject,
  uploadOutput,
  uploadThumbnail,
} from './media.js';
import {
  configuredVisionKind,
  createAnalyzer,
  type EditDecision,
  type PlannedScene,
  type VisionFrame,
} from '../adapters/analyzer.js';
import {
  applyYoloCrops,
  inspectCameras,
  isYoloConfigured,
  trackClipFile,
} from '../adapters/yolo.js';
import { visionCircuit, visionSlot } from '../engine/provider-slots.js';
import {
  applyCutSafety,
  applySmartReframe,
  mapDetectionsToSource,
  scoresFromRanker,
} from '../engine/quality-pass.js';
import {
  buildCameraSignals,
  filterClipsForEdit,
  selectEditorialCameras,
} from '../engine/editorial-select.js';
import {
  createVoiceProvider,
  isVoiceConfigured,
  voiceoverScript,
  type AudioAsset,
} from '../adapters/voice.js';
import { isRealVisionProvider } from '../adapters/vision-provider.js';
import {
  extractClip,
  extractJpegFrameAt,
  extractJpegFrames,
  makeThumbnail,
  scanSegment,
  assertPictureThroughout,
} from './ffmpeg.js';
import { probeMedia } from './probe-media.js';
import { renderComposition } from './composition.js';
import { pickMusicBed } from './music-bed.js';
import { loadFxCatalogFromDisk } from './fx-assets.js';
import { decisionFromReelPlan } from '../engine/director.js';
import { decideWithAiDirector } from '../engine/ai-director.js';
import {
  applyResolvedTimeline,
  directorCandidatesFromClips,
  preferExploredSingleCameraTimeline,
  resolveTimeline,
} from '../engine/scene-resolver.js';
import { applyCompiledGraph } from '../engine/project-plan.js';
import {
  distinctClusterHubs,
  HIGH_QUALITY_CAMERA_SCORE,
  type PeakHit,
} from '../engine/peak-snap.js';
import { casaCompositionLayout } from '../composition/design-system.js';
import { writeProgramAss } from './captions.js';
import { runVisualQc } from './visual-qc.js';
import {
  beginReelExecution,
  currentReelClaim,
  setStatus,
  StaleExecutionError,
  withReelClaim,
} from './status.js';
import { config } from '../config.js';
import { db, log } from '../services.js';
import { workerId } from '../worker-id.js';
import { houseCutFromPlan, keepPictureJoins, ReelPlanner } from '../engine/planner.js';
import { assignStrategicFxAndSpeed, shouldAssignStrategicFx } from '../engine/fx-pass.js';
import {
  judgeFinishedMp4,
  pickScoutedHub,
  refinePlanTakes,
  scoutClusterHubs,
  TakeJudgeError,
  type HubScoutReport,
  type TakeJudgeReport,
} from '../engine/take-judge.js';
import { EDITORIAL, EDITORIAL_RELEASE } from '../engine/editorial-thresholds.js';
import { pairCompatibility } from '../engine/temporal-candidates.js';
import { workerDescriptor } from '../engine/worker-descriptor.js';
import { loadPublishedPlaybook } from '../engine/program-presets.js';
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
  let claim;
  try {
    claim = await beginReelExecution({
      tenantId: payload.tenantId,
      reelId: payload.reelId,
      executionId: randomUUID(),
      workerId,
    });
  } catch (error) {
    if (error instanceof StaleExecutionError) {
      log.warn(jobLog, 'stale execution skipped before start');
      throw new UnrecoverableError('STALE_EXECUTION');
    }
    throw error;
  }
  Object.assign(jobLog, { worker_id: workerId, execution_id: claim.executionId });
  return withReelClaim(claim, () => processClaimedVideo(job, payload, jobLog, authoritative));
}

async function processClaimedVideo(
  job: Job<VideoJob>,
  payload: VideoJob,
  jobLog: Record<string, unknown>,
  authoritative: Awaited<ReturnType<typeof verifyAuthoritativeData>>,
) {
  await mkdir(config.WORK_DIR, { recursive: true });
  const dir = await mkdtemp(path.join(config.WORK_DIR, 'job-'));
  const timings: Record<string, number> = {};
  let takeJudgeReports: TakeJudgeReport[] = [];
  let hubScoutReports: HubScoutReport[] = [];
  const hubByCamera = new Map<string, number>();
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
            maxPeaks: payload.program === 'casa' ? 16 : 8,
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
    if (payload.program === 'casa') {
      const scoutStarted = Date.now();
      for (const clip of clips) {
        const peaks = peaksByCamera.get(clip.cameraId) ?? [];
        const hubs = distinctClusterHubs(
          {
            windowStart: clip.startOffsetSeconds,
            windowDuration: clip.windowDurationSeconds ?? requestedDuration,
            takeDuration: 12,
            peaks,
          },
          EDITORIAL.maxScoutHubs,
        );
        const reports = await scoutClusterHubs({
          program: payload.program,
          cameraId: clip.cameraId,
          sourcePath: clip.localPath,
          hubs,
          dir,
          extractFrame: extractJpegFrameAt,
        });
        hubScoutReports.push(...reports);
        const chosen = pickScoutedHub(reports);
        if (chosen) hubByCamera.set(clip.cameraId, chosen.hub);
      }
      timings.hubScoutMs = Date.now() - scoutStarted;
      log.info(
        {
          ...jobLog,
          hubs: hubScoutReports.map((row) => ({
            hub: row.hub,
            quality: row.visualQuality,
            relevance: row.contentRelevance,
            reason: row.reason,
          })),
          chosen: [...hubByCamera.entries()],
          ms: timings.hubScoutMs,
        },
        'cluster hub scout',
      );
      if (hubScoutReports.length && !hubByCamera.size) {
        throw new TakeJudgeError(
          hubScoutReports.sort((left, right) => right.contentRelevance - left.contentRelevance)[0]
            ?.reason ?? 'no relevant cluster',
        );
      }
    }
    const playbook = await loadPublishedPlaybook(payload.program);
    let cameraRank: Awaited<ReturnType<typeof inspectCameras>> = [];
    if (config.ENABLE_MULTICAMERA_RANKER && (isYoloConfigured() || framePaths.length)) {
      try {
        cameraRank = await inspectCameras({
          cameras: clips.map((clip) => ({ position: clip.position, role: clip.role })),
          framePaths,
        });
        log.info(
          {
            ...jobLog,
            rank: cameraRank.map((row) => `C${row.cameraPosition}:${row.score}`),
          },
          'multicamera ranker',
        );
      } catch (error) {
        log.warn(
          { ...jobLog, err: error instanceof Error ? error.message : error },
          'multicamera ranker skipped',
        );
      }
    }
    if (!visionCircuit.allow()) throw new Error('VISION_CIRCUIT_OPEN');
    let analysis = stored;
    let plan;
    let editorial: ReturnType<typeof selectEditorialCameras> | null = null;
    let workingClips = clips;
    try {
      const vision = await visionSlot.run(async () => {
        const nextAnalysis = analysis ?? (await analyzer.analyze(clips));
        const signals = buildCameraSignals({ clips, analysis: nextAnalysis, yolo: cameraRank });
        const nextEditorial = selectEditorialCameras(signals);
        const nextWorking = filterClipsForEdit(clips, nextEditorial);
        log.info(
          {
            ...jobLog,
            mode: nextEditorial.recommendedMode,
            primary: `C${nextEditorial.primaryCameraPosition}`,
            compatible: nextEditorial.compatibleCameraIds,
            rejected: nextEditorial.rejected.map((row) => `C${row.cameraPosition}:${row.reason}`),
            scores: nextEditorial.scores.map((row) => `C${row.cameraPosition}:${row.score}`),
          },
          'scene coherence gate',
        );
        return {
          analysis: nextAnalysis,
          editorial: nextEditorial,
          workingClips: nextWorking,
          plan: await planner.plan(nextWorking, nextAnalysis, {
            peaksByCamera,
            program: payload.program,
            playbook,
            cameraScores: nextEditorial.scores.length
              ? new Map(nextEditorial.scores.map((row) => [row.cameraPosition, row.score]))
              : cameraRank.length
                ? scoresFromRanker(cameraRank)
                : undefined,
            editMode: nextEditorial.recommendedMode,
            compatiblePositions: new Set(nextWorking.map((clip) => clip.position)),
            hubByCamera,
          }),
        };
      });
      analysis = vision.analysis;
      editorial = vision.editorial;
      workingClips = vision.workingClips;
      plan = vision.plan;
      visionCircuit.success();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/429|RATE_LIMIT|TIMEOUT|ECONNREFUSED|5\d\d|VISION_CIRCUIT/i.test(message)) {
        visionCircuit.failure();
      }
      throw error;
    }
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

    const sourceByCamera = new Map<number, { width: number; height: number }>();
    for (const clip of clips) {
      if (sourceByCamera.has(clip.position)) continue;
      try {
        const sourceProbe = await probeMedia(clip.localPath);
        const width = sourceProbe.video?.width;
        const height = sourceProbe.video?.height;
        if (width && height) sourceByCamera.set(clip.position, { width, height });
      } catch (error) {
        log.warn(
          { camera: clip.position, err: error instanceof Error ? error.message : String(error) },
          'source probe skipped',
        );
      }
    }

    const skipSubjectCrop = payload.program === 'casa';
    if (!skipSubjectCrop && isYoloConfigured() && framePaths.length) {
      await setStatus(
        payload.tenantId,
        payload.reelId,
        'analyzing',
        48,
        'Enquadrando sujeito 9:16',
      );
      const yoloStarted = Date.now();
      const yolo = await applyYoloCrops({ scenes: plan.scenes, framePaths, sourceByCamera });
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
    let timelineSource: 'decision_v2' | 'legacy_plan' | 'video_project' = 'legacy_plan';
    const savedProject = parseVideoProject(authoritative.videoProject);
    const renderFromProject = Boolean(
      authoritative.renderFromProject &&
      savedProject.success &&
      savedProject.data.ai?.renderFromProject,
    );
    if (renderFromProject && savedProject.success) {
      renderPlan = applyCompiledGraph(plan, compileVideoProject(savedProject.data), workingClips);
      timelineSource = 'video_project';
      directorRequested = 'legacy';
      directorUsed = 'legacy';
      directorFallbackReason = 'VIDEO_PROJECT';
    } else if (config.ENABLE_AI_DIRECTOR) {
      try {
        const ai = await decideWithAiDirector({
          plan,
          clips: workingClips,
          ids,
          brand: authoritative.brand,
          cameraRank: (editorial?.scores ?? cameraRank).map((row) => ({
            cameraPosition: row.cameraPosition,
            cameraRole: row.cameraRole,
            score: row.score,
          })),
          coherence: editorial
            ? {
                recommendedMode: editorial.recommendedMode,
                primaryCameraId: editorial.primaryCameraId,
                compatibleCameraIds: editorial.compatibleCameraIds,
                rejected: editorial.rejected,
                multicameraConfidence: editorial.multicameraConfidence,
              }
            : undefined,
        });
        decisionV2 = {
          ...ai.decision,
          editMode: editorial?.recommendedMode ?? ai.decision.editMode,
        };
        decision = videoEditDecisionV2ToV1(decisionV2);
        const resolved = resolveTimeline(
          decisionV2,
          directorCandidatesFromClips(workingClips),
          plan,
        );
        const explored = preferExploredSingleCameraTimeline({
          editMode: decisionV2.editMode,
          highQualitySource:
            Math.max(
              0,
              ...(editorial?.scores.map((row) => row.score) ?? []),
              ...(plan.cameraRankings?.map((row) => row.score) ?? []),
            ) >= HIGH_QUALITY_CAMERA_SCORE,
          resolved,
          playbook: plan,
          windowDurationSeconds: Math.max(
            0,
            ...workingClips.map((clip) => clip.windowDurationSeconds ?? 0),
          ),
        });
        renderPlan = applyResolvedTimeline(plan, explored.timeline);
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
    const windowByCamera = new Map(
      clips.map((clip) => [
        clip.cameraId,
        {
          start: clip.startOffsetSeconds,
          duration: clip.windowDurationSeconds ?? requestedDuration,
        },
      ]),
    );
    renderPlan = {
      ...renderPlan,
      scenes: applyCutSafety(renderPlan.scenes, peaksByCamera, windowByCamera),
    };
    if (!skipSubjectCrop && isYoloConfigured()) {
      const yoloStarted = Date.now();
      const takeFrames: Array<{ cameraPosition: number; path: string; sceneIndex: number }> = [];
      for (let index = 0; index < renderPlan.scenes.length; index += 1) {
        const scene = renderPlan.scenes[index]!;
        const framePath = path.join(dir, `crop-take-${index}.jpg`);
        try {
          await extractJpegFrameAt(
            scene.source_recording_path,
            scene.source_start_offset + Math.max(0.2, scene.duration * 0.4),
            framePath,
          );
          takeFrames.push({ cameraPosition: scene.position, path: framePath, sceneIndex: index });
        } catch (error) {
          log.warn(
            { ...jobLog, take: index, err: error instanceof Error ? error.message : String(error) },
            'take crop frame skipped',
          );
        }
      }
      if (takeFrames.length) {
        const yolo = await applyYoloCrops({
          scenes: renderPlan.scenes,
          framePaths: takeFrames,
          sourceByCamera,
        });
        timings.yoloMs = (timings.yoloMs ?? 0) + (Date.now() - yoloStarted);
        log.info({ ...jobLog, ...yolo, ms: timings.yoloMs }, 'yolo crop per take');
      }
    }
    if (!skipSubjectCrop && config.ENABLE_SMART_REFRAME) {
      const trackIndexes = new Set<number>();
      renderPlan.scenes.forEach((scene, index) => {
        if (trackIndexes.size >= 2) return;
        if (scene.shotStyle === 'tracked_subject') trackIndexes.add(index);
      });
      const nextScenes = [];
      for (let index = 0; index < renderPlan.scenes.length; index += 1) {
        const scene = renderPlan.scenes[index]!;
        let people: Array<{
          detectorClass: string;
          confidence: number;
          bbox: [number, number, number, number];
        }> = [];
        let food: typeof people = [];
        let tracks: Array<{
          timeMs: number;
          trackId: number;
          bbox: [number, number, number, number];
          confidence: number;
          className: string;
        }> = [];
        const source = sourceByCamera.get(scene.position);
        const frameWidth = source?.width ?? 1280;
        const frameHeight = source?.height ?? 720;
        if (config.ENABLE_TRACKING && isYoloConfigured() && trackIndexes.has(index) && source) {
          const clipPath = path.join(dir, `track-${index}.mp4`);
          try {
            await extractClip(
              scene.source_recording_path,
              scene.source_start_offset,
              Math.min(8, scene.duration),
              clipPath,
            );
            const tracked = await trackClipFile(clipPath);
            const analysis =
              tracked?.frame?.width && tracked.frame.height
                ? { width: tracked.frame.width, height: tracked.frame.height }
                : undefined;
            if (!analysis) throw new Error('TRACK_FRAME_SIZE_MISSING');
            const rawPeople: typeof people = [];
            const rawFood: typeof food = [];
            const rawTracks: typeof tracks = [];
            for (const row of tracked?.people ?? []) {
              if (row.track_id == null) continue;
              rawTracks.push({
                timeMs: row.time_ms,
                trackId: row.track_id,
                bbox: row.bbox,
                confidence: row.confidence,
                className: row.class_name,
              });
              rawPeople.push({
                detectorClass: 'person',
                confidence: row.confidence,
                bbox: row.bbox,
              });
            }
            for (const row of tracked?.food ?? []) {
              rawFood.push({
                detectorClass: row.class_name,
                confidence: row.confidence,
                bbox: row.bbox,
              });
            }
            people = mapDetectionsToSource(rawPeople, analysis, source);
            food = mapDetectionsToSource(rawFood, analysis, source);
            tracks = mapDetectionsToSource(rawTracks, analysis, source);
          } catch (error) {
            people = [];
            food = [];
            tracks = [];
            log.warn(
              { ...jobLog, err: error instanceof Error ? error.message : error },
              'scene tracking skipped',
            );
          }
        }
        nextScenes.push(
          applySmartReframe(scene, {
            people,
            food,
            tracks,
            frameWidth,
            frameHeight,
            enableTracking: Boolean(tracks.length),
          }),
        );
      }
      renderPlan = { ...renderPlan, scenes: nextScenes };
    }
    if (!renderFromProject) {
      renderPlan = keepPictureJoins({
        ...renderPlan,
        scenes: lockScenesToLiveSubject(
          renderPlan.scenes,
          (scene) => sourceByCamera.get(scene.position),
          { containAll: payload.program === 'casa' },
        ),
      });
      await setStatus(payload.tenantId, payload.reelId, 'rendering', 58, 'Conferindo cada take');
      const judgeStarted = Date.now();
      const judged = await refinePlanTakes({
        plan: renderPlan,
        peaksByCamera,
        windows: windowByCamera,
        dir,
        extractFrame: extractJpegFrameAt,
        hubByCamera,
      });
      renderPlan = judged.plan;
      takeJudgeReports = judged.reports;
      timings.takeJudgeMs = Date.now() - judgeStarted;
      log.info(
        {
          ...jobLog,
          release_stamp: EDITORIAL_RELEASE,
          takes: renderPlan.scenes.map(
            (scene) => `C${scene.position}:${scene.source_start_offset.toFixed(1)}s`,
          ),
          decisions: takeJudgeReports.map((row) => ({
            take: row.takeIndex,
            decision: row.decision,
            quality: row.visualQuality,
            relevance: row.contentRelevance,
            reason: row.reason,
          })),
          ms: timings.takeJudgeMs,
        },
        'take judge',
      );
      renderPlan = keepPictureJoins({
        ...renderPlan,
        scenes: lockScenesToLiveSubject(
          renderPlan.scenes,
          (scene) => sourceByCamera.get(scene.position),
          { containAll: payload.program === 'casa' },
        ),
      });
      if (shouldAssignStrategicFx(payload.program, renderPlan.scenes)) {
        renderPlan = assignStrategicFxAndSpeed({
          plan: renderPlan,
          catalog: loadFxCatalogFromDisk().assets,
          peaksByCamera,
          outputSeconds: renderPlan.duration,
        });
      }
    }
    const brandingRaw = playbook.branding ?? defaultBrandingFor(payload.program);
    const branding = payload.program === 'casa' ? { ...brandingRaw, title: false } : brandingRaw;
    const safeCaption = groundedCaption({
      caption: renderPlan.caption,
      visionReason: [plan.reason, ...(plan.cameraRankings ?? []).map((row) => row.reason)].join(
        ' ',
      ),
      restaurantName: authoritative.restaurantName,
    });
    const copy = programBrandCopy({
      restaurantName: authoritative.restaurantName,
      program: payload.program,
      cta: authoritative.brand.cta ?? decision.text.cta,
    });
    let logoPath: string | null = null;
    if (branding.logo && authoritative.brand.logoObjectKey) {
      const key = authoritative.brand.logoObjectKey;
      const ext = path.extname(key) || '.png';
      const dest = path.join(dir, `logo-partner${ext}`);
      try {
        await downloadObject(key, dest);
        logoPath = dest;
      } catch (error) {
        log.warn(
          {
            ...jobLog,
            err: error instanceof Error ? error.message : String(error),
            logo_key: key,
          },
          'partner logo missing; burning wordmark',
        );
      }
    }
    const captions = await writeProgramAss(dir, renderPlan.duration, {
      caption: renderPlan.captionStrategy === 'full' ? safeCaption : null,
      title: branding.title ? copy.title : null,
      lowerThird: branding.lowerThird ? copy.lowerThird : null,
      cta: branding.cta ? copy.cta : null,
      endCard: branding.endCard ? copy.endCard : null,
      wordmark: branding.logo && !logoPath ? copy.wordmark : null,
    });
    let voiceAsset: AudioAsset | null = null;
    const musicBed = pickMusicBed(payload.reelId);
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
    if (musicBed) {
      decision = {
        ...decision,
        audio: {
          ...decision.audio,
          strategy: voiceAsset
            ? 'voiceover_plus_music'
            : renderPlan.audio
              ? 'ambient_plus_music'
              : 'music_only',
          musicGainDb: -6,
          preserveAmbient: Boolean(renderPlan.audio),
        },
      };
      decisionV2 = adaptVideoEditDecisionV1ToV2(decision);
    }
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
        logoPath,
        endCard: branding.endCard,
        musicPath: musicBed?.source,
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
    await assertPictureThroughout(output, probe.durationSeconds ?? renderPlan.duration);
    await judgeFinishedMp4({
      program: payload.program,
      mp4: output,
      durationSeconds: probe.durationSeconds ?? renderPlan.duration,
      dir,
      extractFrame: extractJpegFrameAt,
    });
    const technical = evaluateTechnicalQuality(probe, {
      videoCodec: 'h264',
      pixFmt: 'yuv420p',
      requireAudio: Boolean(renderPlan.audio || voiceAsset),
    });
    if (technical.status !== 'passed') {
      throw new Error(`TECHNICAL_QC:${technical.issues.map((issue) => issue.code).join(',')}`);
    }
    const layout = casaCompositionLayout;
    const compositionQc = evaluateCompositionQuality({
      title: branding.title ? copy.title : null,
      titleBox: branding.title ? layout.titleBox : null,
      logoBox: branding.logo ? layout.logoBox : null,
      ctaBox: branding.cta ? layout.ctaBox : null,
      showLogo: branding.logo,
      logoPresent: branding.logo,
      assetsLoaded: [
        ...(logoPath ? ['partner-logo'] : branding.logo ? ['wordmark'] : []),
        render.renderer === 'revideo' ? 'revideo-branding' : 'ffmpeg-ass',
      ],
      fontsLoaded: render.renderer === 'revideo' ? layout.fonts : ['Arial'],
      fixtureBranding: render.renderer === 'revideo' ? layout.fixtureBranding : false,
      safeArea: layout.safeArea,
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
    const claim = currentReelClaim();
    const keys = executionObjectKeys(base, claim?.executionId ?? 'orphan');
    await uploadOutput(output, keys.stagingVideo);
    await uploadThumbnail(thumbnail, keys.stagingThumb);
    const { data: ownership } = await db
      .from('reels')
      .select('metadata')
      .eq('id', payload.reelId)
      .eq('tenant_id', payload.tenantId)
      .single();
    const currentExecutionId = (ownership?.metadata as { execution_id?: string } | null)
      ?.execution_id;
    if (!claim || !canPromoteFinalOutput(currentExecutionId, claim.executionId)) {
      throw new StaleExecutionError();
    }
    await copyObject(keys.stagingVideo, keys.canonicalVideo);
    await copyObject(keys.stagingThumb, keys.canonicalThumb);
    timings.finalUploadMs = Date.now() - uploadStarted;
    await setStatus(payload.tenantId, payload.reelId, 'ready', 100, 'Reel pronto para revisão', {
      output_path: keys.canonicalVideo,
      thumbnail_path: keys.canonicalThumb,
      duration_seconds: actualDuration,
      score: plan.score,
      caption: [plan.caption, ...(plan.hashtags ?? [])].filter(Boolean).join(' ') || null,
      metadata: {
        analysis: plan.reason,
        provider: plan.provider,
        model: plan.model,
        release_stamp: EDITORIAL_RELEASE,
        worker: workerDescriptor(),
        take_judge: takeJudgeReports,
        hub_scout: hubScoutReports,
        cameras: renderPlan.scenes.map((scene) => scene.camera_id),
        sourceAudio: Boolean(renderPlan.audio),
        music_bed: musicBed
          ? {
              assetId: musicBed.assetId,
              licenseType: musicBed.licenseType,
              licenseReference: musicBed.licenseReference,
              provider: musicBed.provider,
            }
          : null,
        program: plan.program,
        join: plan.join,
        detailedScores: plan.detailedScores,
        people_score: plan.peopleScore,
        story_score: plan.storyScore,
        confidence: plan.confidence,
        privacy_risk: plan.privacyRisk,
        recommended_use: plan.recommendedUse,
        house_cut: houseCutFromPlan(renderPlan),
        video_project:
          renderFromProject && savedProject.success
            ? savedProject.data
            : projectFromDecision({
                decision: decisionV2,
                takes: workingClips.map((clip) => ({
                  recordingId: clip.recordingId ?? clip.cameraId,
                  cameraId: clip.cameraId,
                  cameraPosition: clip.position,
                  cameraLabel: `C${clip.position}`,
                  durationMs: Math.round((clip.windowDurationSeconds ?? 20) * 1000),
                  hasAudio: clip.hasAudio,
                })),
                name: plan.caption || undefined,
              }),
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
        scene_coherence: editorial
          ? {
              mode: editorial.recommendedMode,
              confidence: editorial.multicameraConfidence,
              primary: `C${editorial.primaryCameraPosition}`,
              compatible: editorial.compatibleCameraIds,
              rejected: editorial.rejected,
              scores: editorial.scores.map((row) => ({
                camera: `C${row.cameraPosition}`,
                score: row.score,
                reasons: row.reasons,
              })),
            }
          : null,
        edit_mode: editorial?.recommendedMode ?? null,
        scenes: renderPlan.scenes.map((scene, index) => {
          const report = takeJudgeReports.find(
            (row) => row.takeIndex === index && row.decision === 'ACCEPT',
          );
          const previous = renderPlan.scenes[index - 1];
          const pair = previous
            ? pairCompatibility(
                {
                  cameraId: previous.camera_id,
                  start: previous.source_start_offset,
                  end: previous.source_start_offset + previous.duration,
                  peak: previous.source_start_offset,
                  fusedScore: 0,
                  usable: true,
                },
                {
                  cameraId: scene.camera_id,
                  start: scene.source_start_offset,
                  end: scene.source_start_offset + scene.duration,
                  peak: scene.source_start_offset,
                  fusedScore: 0,
                  usable: true,
                },
              )
            : null;
          return {
            cam: `C${scene.position}`,
            cameraId: scene.camera_id,
            recordingId: scene.recording_id ?? null,
            role: scene.role,
            desc: scene.reason,
            offset: scene.source_start_offset,
            sourceIn: scene.source_start_offset,
            sourceOut: scene.source_start_offset + scene.duration,
            duration: scene.duration,
            transition: scene.transition,
            punchIn: scene.punchIn,
            motion: scene.motion,
            crop: scene.crop ?? null,
            cropMode: scene.cropMode ?? null,
            cropTight: scene.cropTight ?? null,
            cameraScore:
              editorial?.scores.find((row) => row.cameraPosition === scene.position)?.score ?? null,
            coherenceScore: editorial?.multicameraConfidence ?? null,
            pairCompatibility: pair,
            visualQuality: report?.visualQuality ?? null,
            contentRelevance: report?.contentRelevance ?? null,
            hookScore: report?.hookScore ?? null,
            judgeDecision: report?.decision ?? null,
            judgeReason: report?.reason ?? null,
          };
        }),
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
    if (error instanceof StaleExecutionError) {
      log.warn(jobLog, 'stale execution aborted');
      throw new UnrecoverableError('STALE_EXECUTION');
    }
    const attempts = Number(job.opts.attempts ?? 1);
    const finalAttempt = job.attemptsMade + 1 >= attempts;
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    if (error instanceof TakeJudgeError && error.reports.length) {
      takeJudgeReports = error.reports;
    }
    if (message === 'JOB_NOT_PROCESSABLE' || message === 'STALE_EXECUTION') {
      throw new UnrecoverableError(message);
    }
    const fatal = [
      'GEMINI_API_BLOCKED',
      'OPENAI_API_BLOCKED',
      'VISION_PROVIDER_NOT_CONFIGURED',
      'FRAME_EXTRACTION_FAILED',
      'SKIP_PROGRAM',
      'TECHNICAL_QC',
      'COMPOSITION_QC',
      'TAKE_JUDGE_FAILED',
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
        metadata: {
          release_stamp: EDITORIAL_RELEASE,
          worker: workerDescriptor(),
          take_judge: takeJudgeReports,
          hub_scout: hubScoutReports,
          timings,
        },
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
      'id,tenant_id,restaurant_id,moment_id,status,metadata,moments(occurred_at,window_start,window_end),restaurants(name,settings,timezone)',
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
    name?: string;
    settings: Record<string, unknown>;
    timezone?: string;
  };
  const styleValue = String(restaurant.settings?.active_style ?? 'natural');
  const style: StyleName =
    styleValue === 'dynamic' || styleValue === 'cinematic' ? styleValue : 'natural';
  const brand = brandFromRestaurantSettings(restaurant.settings);
  const enableRevideo =
    restaurant.settings?.enableRevideo === true || restaurant.settings?.videoPipeline === 'v2';
  const metadata =
    reel.metadata && typeof reel.metadata === 'object'
      ? (reel.metadata as Record<string, unknown>)
      : {};
  return {
    style,
    prompt:
      typeof restaurant.settings?.capture_prompt === 'string'
        ? restaurant.settings.capture_prompt
        : undefined,
    timezone: restaurant.timezone || 'America/Sao_Paulo',
    brand,
    restaurantName: typeof restaurant.name === 'string' ? restaurant.name : 'Casa',
    enableRevideo,
    videoProject: metadata.video_project,
    renderFromProject: metadata.render_from_project === true,
  };
}
