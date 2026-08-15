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
import { joinedDuration } from '../pipeline/finish.js';
import {
  evaluateCompositionQuality,
  evaluateTechnicalQuality,
  groundedCaption,
} from '@reelops/shared';
import { casaCompositionLayout } from '../composition/design-system.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const quality = path.join(root, 'work/quality');
const source = 'D:\\DEV\\TESTE2.mp4';
const inspectDir = path.join(quality, 'inspect-teste2');

if (!existsSync(source)) {
  throw new Error(`TESTE2_MISSING:${source}`);
}

const cameraId = 'e2e2e2e2-2222-4222-8222-222222222222';
const recordingId = 'e2e2e2e2-3333-4333-8333-222222222222';

const clips: ClipCandidate[] = [
  {
    cameraId,
    recordingId,
    path: source,
    localPath: source,
    position: 1,
    startOffsetSeconds: 120,
    windowDurationSeconds: 38,
    hasAudio: true,
    role: 'master',
  },
];

const framePaths: VisionFrame[] = [10, 50, 90].map((pct) => ({
  cameraPosition: 1,
  path: path.join(inspectDir, `C1-${pct}.jpg`),
}));

function pinFourParts(plan: ReelPlan): ReelPlan {
  const scenes =
    plan.scenes.length === 4
      ? plan.scenes
      : plan.scenes.length > 4
        ? [plan.scenes[0]!, plan.scenes[1]!, plan.scenes[2]!, plan.scenes.at(-1)!]
        : plan.scenes;
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
    'Uma única câmera (TESTE2). Descreva o que está na imagem. Não invente restaurante, prato ou cidade. Não invente outras câmeras. Corte em quatro takes na mesma câmera.',
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
try {
  const ai = await decideWithAiDirector({
    plan,
    clips: working,
    ids: {
      tenantId: '6399a79c-6b2d-4672-9132-3870bf5e0fbc',
      restaurantId: 'dbd3c84b-aa9d-40df-8245-259d27a83292',
      momentId: 'd00d0000-2222-4222-8333-777777777777',
      reelId: '22222222-aaaa-4bbb-8ccc-dddddddddddd',
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

renderPlan = pinFourParts(renderPlan);
if (renderPlan.scenes.length !== 4) {
  throw new Error(`EXPECTED_4_PARTS:${renderPlan.scenes.length}`);
}

mkdirSync(path.join(quality, 'teste-automatic'), { recursive: true });
const output = path.join(quality, 'quality-teste2-cut.mp4');
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
  stock: 'D:\\DEV\\TESTE2.mp4 only',
  note: 'Single-camera 4-part cut from TESTE2. TESTE2 MD5 equals TESTE1. Not FIRST PREMIUM REEL VALIDATED.',
  window: { startOffsetSeconds: 120, windowDurationSeconds: 38 },
  editorial: {
    mode: 'single_camera',
    primary: editorial.primaryCameraPosition,
    rejected: editorial.rejected,
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
  parts: renderPlan.scenes.length,
  duration: renderPlan.duration,
  scenes: renderPlan.scenes.map((scene) => ({
    cam: `C${scene.position}`,
    role: scene.role,
    offset: scene.source_start_offset,
    duration: scene.duration,
    reason: scene.reason,
  })),
  audio: probe.audio ?? null,
  technicalQc: technical.status,
  technicalIssues: technical.issues,
  compositionQc: composition.status,
  compositionIssues: composition.issues,
  output,
};
writeFileSync(path.join(quality, 'teste2-cut.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(0);
