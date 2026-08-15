import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

const cameras = [
  {
    position: 1,
    role: 'master' as const,
    cameraId: '92317772-6273-4297-86a3-493a8a7b4abb',
    recordingId: '0b041ffe-5800-4b67-a95e-b5c109172a0e',
    file: 'C1.mp4',
  },
  {
    position: 2,
    role: 'side' as const,
    cameraId: 'c579f48e-8b44-4416-b482-dd7da5ad078b',
    recordingId: 'abff26f5-4aa0-46b9-b5ed-639cceb047ae',
    file: 'C2.mp4',
  },
  {
    position: 3,
    role: 'food' as const,
    cameraId: '0025e7b8-0695-42ff-9230-5b2b5fb505d5',
    recordingId: '87bd8106-ba19-444c-b022-c61f0dd15017',
    file: 'C3.mp4',
  },
  {
    position: 4,
    role: 'ambience' as const,
    cameraId: '83724128-f29a-4fa7-ba36-94af2f37dc',
    recordingId: 'b4f26b68-eb4e-4d2b-8a2b-686194bc64a2',
    file: 'C4.mp4',
  },
];

const clips: ClipCandidate[] = cameras.map((camera) => ({
  cameraId: camera.cameraId,
  recordingId: camera.recordingId,
  path: path.join(quality, 'source', camera.file),
  localPath: path.join(quality, 'source', camera.file),
  position: camera.position,
  startOffsetSeconds: 5,
  windowDurationSeconds: 38,
  hasAudio: camera.position === 1,
  role: camera.role,
}));

const framePaths: VisionFrame[] = [1, 2, 3, 4].flatMap((position) =>
  [10, 50, 90].map((pct) => ({
    cameraPosition: position,
    path: path.join(quality, 'inspect', `C${position}-${pct}.jpg`),
  })),
);

const parsed = await analyzeMomentFramesOpenAI({
  frames: framePaths,
  style: 'cinematic',
  cameras: [1, 2, 3, 4],
  prompt:
    'Se as câmeras não forem o mesmo restaurante, diga. Penalize watermark CANAL MADEIRA / Caravela. Não force C4.',
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
      momentId: '89a35d82-7a28-40fb-b746-9ab109bbaa09',
      reelId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
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

const previousAutomatic = path.join(quality, 'quality-first-automatic.mp4');
const baselineC = path.join(quality, 'quality-first-automatic-c.mp4');
if (existsSync(previousAutomatic) && !existsSync(baselineC)) {
  copyFileSync(previousAutomatic, baselineC);
}

const outDir = path.join(quality, 'automatic');
mkdirSync(outDir, { recursive: true });
const output = path.join(quality, 'quality-first-automatic-d.mp4');
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
copyFileSync(output, previousAutomatic);

const probe = await probeMedia(output);
const technical = evaluateTechnicalQuality(probe, {
  videoCodec: 'h264',
  pixFmt: 'yuv420p',
  requireAudio: Boolean(renderPlan.audio),
});
const layout = casaCompositionLayout;
const composition = evaluateCompositionQuality({
  title: null,
  showLogo: false,
  assetsLoaded: ['ffmpeg-ass'],
  fontsLoaded: ['Arial'],
  fixtureBranding: false,
  safeArea: layout.safeArea,
});

const report = {
  moment_id: '89a35d82-7a28-40fb-b746-9ab109bbaa09',
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
writeFileSync(path.join(quality, 'automatic-editorial.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(0);
