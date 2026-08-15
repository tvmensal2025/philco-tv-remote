import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeMomentFramesOpenAI,
  decisionFromVision,
  type ClipCandidate,
  type VisionFrame,
} from '../adapters/analyzer.js';
import { compileProgram } from './planner.js';
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
import {
  evaluateCompositionQuality,
  evaluateTechnicalQuality,
  groundedCaption,
} from '@reelops/shared';
import { casaCompositionLayout } from '../composition/design-system.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const quality = path.join(root, 'work/quality');
const sourceDir = 'D:\\DEV';
const inspectDir = path.join(quality, 'inspect-teste');

const cameras = [
  {
    position: 1,
    role: 'master' as const,
    cameraId: 'e1e1e1e1-1111-4111-8111-111111111111',
    recordingId: 'e1e1e1e1-2222-4222-8222-111111111111',
    file: 'TESTE1.mp4',
  },
  {
    position: 2,
    role: 'side' as const,
    cameraId: 'e1e1e1e1-1111-4111-8111-111111111112',
    recordingId: 'e1e1e1e1-2222-4222-8222-111111111112',
    file: 'TESTE2.mp4',
  },
  {
    position: 3,
    role: 'food' as const,
    cameraId: 'e1e1e1e1-1111-4111-8111-111111111113',
    recordingId: 'e1e1e1e1-2222-4222-8222-111111111113',
    file: 'TESTE3.mp4',
  },
  {
    position: 4,
    role: 'ambience' as const,
    cameraId: 'e1e1e1e1-1111-4111-8111-111111111114',
    recordingId: 'e1e1e1e1-2222-4222-8222-111111111114',
    file: 'TESTE4.mp4',
  },
];

for (const camera of cameras) {
  const file = path.join(sourceDir, camera.file);
  if (!existsSync(file)) {
    throw new Error(`TESTE_SOURCE_MISSING:${file}`);
  }
}

const clips: ClipCandidate[] = cameras.map((camera) => ({
  cameraId: camera.cameraId,
  recordingId: camera.recordingId,
  path: path.join(sourceDir, camera.file),
  localPath: path.join(sourceDir, camera.file),
  position: camera.position,
  startOffsetSeconds: 120,
  windowDurationSeconds: 38,
  hasAudio: camera.position === 1,
  role: camera.role,
}));

const framePaths: VisionFrame[] = [1, 2, 3, 4].flatMap((position) =>
  [10, 50, 90].map((pct) => ({
    cameraPosition: position,
    path: path.join(inspectDir, `C${position}-${pct}.jpg`),
  })),
);

const parsed = await analyzeMomentFramesOpenAI({
  frames: framePaths,
  style: 'cinematic',
  cameras: [1, 2, 3, 4],
  prompt:
    'Se as câmeras não forem o mesmo lugar e o mesmo evento no mesmo instante, diga. Não invente restaurante. Não force câmera. Não misture cenas que não combinam.',
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
  editMode: editorial.recommendedMode,
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
      momentId: 'd00d0000-1111-4222-8333-555555555555',
      reelId: 'eeeeeeee-ffff-4aaa-8bbb-cccccccccccc',
    },
    cameraRank: editorial.scores.map((row) => ({
      cameraPosition: row.cameraPosition,
      cameraRole: row.cameraRole,
      score: row.score,
    })),
    coherence: {
      recommendedMode: editorial.recommendedMode,
      primaryCameraId: editorial.primaryCameraId,
      compatibleCameraIds: editorial.compatibleCameraIds,
      rejected: editorial.rejected,
      multicameraConfidence: editorial.multicameraConfidence,
    },
  });
  const decision = { ...ai.decision, editMode: editorial.recommendedMode };
  const resolved = resolveTimeline(decision, directorCandidatesFromClips(working), plan);
  const explored = preferExploredSingleCameraTimeline({
    editMode: editorial.recommendedMode,
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

mkdirSync(path.join(quality, 'teste-automatic'), { recursive: true });
const output = path.join(quality, 'quality-teste-automatic.mp4');
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
  stock: 'D:\\DEV TESTE1-4',
  note: 'TESTE1 MD5 equals TESTE2. Clips are not simultaneous same-place CCTV. Coherence test only — not FIRST PREMIUM REEL VALIDATED.',
  window: { startOffsetSeconds: 120, windowDurationSeconds: 38 },
  editorial: {
    mode: editorial.recommendedMode,
    confidence: editorial.multicameraConfidence,
    primary: editorial.primaryCameraPosition,
    compatible: editorial.compatibleCameraIds,
    rejected: editorial.rejected,
    scores: editorial.scores.map((row) => ({
      camera: `C${row.cameraPosition}`,
      score: row.score,
      reasons: row.reasons,
    })),
    pairwise: editorial.pairwise,
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
writeFileSync(path.join(quality, 'teste-editorial.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(0);
