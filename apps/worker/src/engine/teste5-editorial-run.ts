import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeMomentFramesOpenAI,
  decisionFromVision,
  type ClipCandidate,
  type VisionFrame,
} from '../adapters/analyzer.js';
import { compileProgram, type ReelPlan } from './planner.js';
import {
  buildCameraSignals,
  filterClipsForEdit,
  selectEditorialCameras,
} from './editorial-select.js';
import { decideWithAiDirector } from './ai-director.js';
import {
  directorCandidatesFromClips,
  preferExploredSingleCameraTimeline,
  resolveTimeline,
  applyResolvedTimeline,
} from './scene-resolver.js';
import { HIGH_QUALITY_CAMERA_SCORE } from './peak-snap.js';
import { renderVertical } from '../pipeline/ffmpeg.js';
import { probeMedia } from '../pipeline/probe-media.js';
import { joinSpec, joinedDuration } from '../pipeline/finish.js';
import { config } from '../config.js';
import {
  evaluateCompositionQuality,
  evaluateTechnicalQuality,
  groundedCaption,
  JOIN_OVERLAY,
  containSubjectCrop,
} from '@reelops/shared';
import { casaCompositionLayout } from '../composition/design-system.js';

config.RENDER_PROFILE = 'high';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const quality = path.join(root, 'work/quality');
const source = 'D:\\DEV\\TESTE5.mp4';
const inspectDir = path.join(quality, 'inspect-teste5');

if (!existsSync(source)) {
  throw new Error(`TESTE5_MISSING:${source}`);
}

const cameraId = 'e5e5e5e5-5555-4555-8555-555555555555';
const recordingId = 'e5e5e5e5-6666-4666-8666-555555555555';
const singerCrop = containSubjectCrop({
  frameWidth: 1280,
  frameHeight: 720,
  subject: { x: 120, y: 60, w: 360, h: 640 },
});

const clips: ClipCandidate[] = [
  {
    cameraId,
    recordingId,
    path: source,
    localPath: source,
    position: 1,
    startOffsetSeconds: 180,
    windowDurationSeconds: 42,
    hasAudio: true,
    role: 'master',
  },
];

const framePaths: VisionFrame[] = [10, 50, 90].map((pct) => ({
  cameraPosition: 1,
  path: path.join(inspectDir, `C1-${pct}.jpg`),
}));

function joinHits(plan: ReelPlan) {
  const hits: Array<{
    index: number;
    transition: string;
    joinDuration: number;
    overlay: string;
    joinStart: number;
    overlayStart: number;
    overlayEnd: number;
  }> = [];
  let elapsed = plan.scenes[0]?.duration ?? 0;
  for (let index = 1; index < plan.scenes.length; index += 1) {
    const scene = plan.scenes[index]!;
    const spec = joinSpec(scene.transition, scene.joinDuration);
    const joinStart = Math.max(0, elapsed - spec.duration);
    const overlay = scene.joinOverlay && scene.joinOverlay !== 'none' ? scene.joinOverlay : 'none';
    const fx = overlay !== 'none' ? JOIN_OVERLAY[overlay] : null;
    hits.push({
      index,
      transition: scene.transition,
      joinDuration: spec.duration,
      overlay,
      joinStart: Number(joinStart.toFixed(3)),
      overlayStart: fx
        ? Number(Math.max(0, joinStart + spec.duration / 2 - fx.duration / 2).toFixed(3))
        : Number(joinStart.toFixed(3)),
      overlayEnd: fx
        ? Number(
            Math.max(0, joinStart + spec.duration / 2 - fx.duration / 2 + fx.duration).toFixed(3),
          )
        : Number((joinStart + spec.duration).toFixed(3)),
    });
    elapsed = elapsed + scene.duration - spec.duration;
  }
  return hits;
}

function withContainCrop(plan: ReelPlan): ReelPlan {
  const scenes = plan.scenes.map((scene) => ({
    ...scene,
    crop: singerCrop.bbox,
    cropMode: singerCrop.mode,
    cropTight: singerCrop.tight,
    motion: 'none' as const,
    punchIn: false,
  }));
  const duration = joinedDuration(
    scenes.map((scene) => ({
      duration: scene.duration,
      transition: scene.transition,
      joinDuration: scene.joinDuration,
    })),
  );
  return {
    ...plan,
    scenes,
    duration,
    audio: plan.audio ? { ...plan.audio, duration } : undefined,
  };
}

const parsed = await analyzeMomentFramesOpenAI({
  frames: framePaths,
  style: 'cinematic',
  cameras: [1],
  prompt:
    'Uma câmera de restaurante/choperia com show ao vivo. Descreva o que está na imagem. Não invente prato. Os logos Battuta, Bem Assados e TV Vila Rica já estão queimados no vídeo — não trate como câmera extra.',
});
const analysis = decisionFromVision(clips, parsed, 'cinematic', framePaths.length, 'openai');
const signals = buildCameraSignals({ clips, analysis });
const editorial = selectEditorialCameras(signals);
const working = filterClipsForEdit(clips, editorial);
const plan = compileProgram({
  clips: working,
  program: 'casa',
  peaksByCamera: new Map(),
  analysis,
  cameraScores: new Map(editorial.scores.map((row) => [row.cameraPosition, row.score])),
  editMode: 'single_camera',
  compatiblePositions: new Set(working.map((clip) => clip.position)),
});

let renderPlan = plan;
let directorUsed = 'legacy';
let usedPlaybookExploration = false;
const systemOverlaysBefore = plan.scenes.map((scene) => scene.joinOverlay ?? 'none');
try {
  const ai = await decideWithAiDirector({
    plan,
    clips: working,
    ids: {
      tenantId: '6399a79c-6b2d-4672-9132-3870bf5e0fbc',
      restaurantId: 'dbd3c84b-aa9d-40df-8245-259d27a83292',
      momentId: 'd00d0000-5555-4555-8555-555555555555',
      reelId: '55555555-aaaa-4bbb-8ccc-dddddddddddd',
    },
    cameraRank: editorial.scores.map((row) => ({
      cameraPosition: row.cameraPosition,
      cameraRole: row.cameraRole,
      score: row.score,
    })),
    coherence: {
      recommendedMode: 'single_camera',
      primaryCameraId: editorial.primaryCameraId,
      compatibleCameraIds: editorial.compatibleCameraIds,
      rejected: editorial.rejected,
      multicameraConfidence: editorial.multicameraConfidence,
    },
  });
  const decision = { ...ai.decision, editMode: 'single_camera' as const };
  const resolved = resolveTimeline(decision, directorCandidatesFromClips(working), plan);
  const explored = preferExploredSingleCameraTimeline({
    editMode: 'single_camera',
    highQualitySource:
      Math.max(
        0,
        ...editorial.scores.map((row) => row.score),
        ...(analysis.cameraRankings?.map((row) => row.score) ?? []),
      ) >= HIGH_QUALITY_CAMERA_SCORE,
    resolved,
    playbook: plan,
    windowDurationSeconds: Math.max(0, ...working.map((clip) => clip.windowDurationSeconds ?? 0)),
  });
  usedPlaybookExploration = explored.usedPlaybookExploration;
  renderPlan = applyResolvedTimeline(plan, explored.timeline);
  directorUsed = 'ai_v2';
} catch (error) {
  directorUsed = `legacy:${error instanceof Error ? error.message.slice(0, 80) : 'fail'}`;
}

if (!directorUsed.startsWith('ai_v2')) {
  throw new Error(`DIRECTOR_DID_NOT_RUN:${directorUsed}`);
}

const systemJoins = renderPlan.scenes.map((scene, index) => ({
  index,
  transition: scene.transition,
  motion: scene.motion ?? null,
  joinOverlay: scene.joinOverlay ?? 'none',
  fadeIn: Boolean(scene.fadeIn),
  fadeOut: Boolean(scene.fadeOut),
  punchIn: Boolean(scene.punchIn),
}));

renderPlan = withContainCrop(renderPlan);
const hits = joinHits(renderPlan);

mkdirSync(path.join(quality, 'teste-automatic'), { recursive: true });
const output = path.join(quality, 'quality-teste5-contain.mp4');
await renderVertical(
  {
    ...renderPlan,
    caption:
      groundedCaption({ caption: renderPlan.caption, visionReason: analysis.reason }) ?? undefined,
  },
  output,
  null,
  null,
  { endCard: true },
);

const probe = await probeMedia(output);
const technical = evaluateTechnicalQuality(probe, {
  videoCodec: 'h264',
  pixFmt: 'yuv420p',
  requireAudio: Boolean(renderPlan.audio),
});
const composition = evaluateCompositionQuality({
  title: null,
  showLogo: false,
  assetsLoaded: ['ffmpeg-ass'],
  fontsLoaded: ['Arial'],
  fixtureBranding: false,
  safeArea: casaCompositionLayout.safeArea,
});

const report = {
  stock: 'D:\\DEV\\TESTE5.mp4 only',
  note: 'Contain 9:16 on the singer. pad_blur if body wider than the slice. No Ken Burns when tight. Casa joins, no factory flash/leak/burn.',
  renderProfile: config.RENDER_PROFILE,
  window: { startOffsetSeconds: 180, windowDurationSeconds: 42 },
  crop: {
    bbox: singerCrop.bbox,
    mode: singerCrop.mode,
    tight: singerCrop.tight,
    why: 'contain subject bbox; do not left-lock on TV logos',
  },
  sourceOverlays: [
    'Battuta chopp (top-left)',
    'Bem Assados (bottom-left)',
    'TV Vila Rica (bottom-right, outside left crop)',
  ],
  systemBeforeOverlayPack: {
    playbookJoinOverlay: systemOverlaysBefore,
    directorJoins: systemJoins,
  },
  joins: hits,
  editorial: {
    mode: 'single_camera',
    scores: editorial.scores.map((row) => ({
      camera: `C${row.cameraPosition}`,
      score: row.score,
      reasons: row.reasons,
    })),
  },
  vision: {
    provider: analysis.provider,
    reason: analysis.reason,
    rankings: analysis.cameraRankings,
    caption: analysis.captionPt,
  },
  directorUsed,
  usedPlaybookExploration,
  duration: renderPlan.duration,
  scenes: renderPlan.scenes.map((scene) => ({
    offset: scene.source_start_offset,
    duration: scene.duration,
    transition: scene.transition,
    joinOverlay: scene.joinOverlay ?? 'none',
    motion: scene.motion ?? null,
    fadeIn: Boolean(scene.fadeIn),
    fadeOut: Boolean(scene.fadeOut),
    reason: scene.reason,
  })),
  audio: probe.audio ?? null,
  technicalQc: technical.status,
  technicalIssues: technical.issues,
  compositionQc: composition.status,
  compositionIssues: composition.issues,
  output,
};
writeFileSync(path.join(quality, 'teste5-joins.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(0);
