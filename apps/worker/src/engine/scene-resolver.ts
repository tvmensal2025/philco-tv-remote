import {
  parseCameraRole,
  resolveEditingIntensityProfile,
  type SceneDecisionV2,
  type VideoEditDecisionV2,
} from '@reelops/shared';
import type { ClipCandidate } from '../adapters/analyzer.js';
import type { ReelPlan, ReelPlanScene } from './planner.js';
import { joinedDuration } from '../pipeline/finish.js';

export type DirectorCandidate = {
  cameraId: string;
  recordingId: string;
  cameraPosition: number;
  cameraRole: string;
  cameraLabel: string;
  localPath: string;
  startOffsetSeconds: number;
  windowDurationSeconds: number;
  hasAudio: boolean;
};

export type ResolvedTimeline = {
  source: 'decision_v2';
  scenes: ReelPlanScene[];
  duration: number;
};

const LABEL = /^(?:c(?:amera)?[\s._-]?)(\d{1,2})$/i;

export function directorCandidatesFromClips(clips: ClipCandidate[]): DirectorCandidate[] {
  return clips.map((clip) => ({
    cameraId: clip.cameraId,
    recordingId: clip.recordingId ?? clip.cameraId,
    cameraPosition: clip.position,
    cameraRole: clip.role ?? 'master',
    cameraLabel: `C${clip.position}`,
    localPath: clip.localPath,
    startOffsetSeconds: clip.startOffsetSeconds,
    windowDurationSeconds: clip.windowDurationSeconds ?? 20,
    hasAudio: clip.hasAudio,
  }));
}

function candidateByLabel(
  value: unknown,
  byLabel: Map<string, DirectorCandidate>,
  byPosition: Map<number, DirectorCandidate>,
) {
  const match = String(value ?? '')
    .trim()
    .match(LABEL);
  if (!match) return undefined;
  return byLabel.get(`c${match[1]}`) ?? byPosition.get(Number(match[1]));
}

function resolveCandidate(
  scene: { cameraId: string; recordingId: string; cameraPosition?: number },
  candidates: DirectorCandidate[],
): DirectorCandidate {
  if (!candidates.length) throw new Error('DIRECTOR_INVALID_REFERENCE');
  const byCamera = new Map(candidates.map((item) => [item.cameraId, item]));
  const byRecording = new Map(candidates.map((item) => [item.recordingId, item]));
  const byPosition = new Map(candidates.map((item) => [item.cameraPosition, item]));
  const byLabel = new Map(candidates.map((item) => [item.cameraLabel.toLowerCase(), item]));
  return (
    byCamera.get(scene.cameraId) ??
    byRecording.get(scene.cameraId) ??
    byCamera.get(scene.recordingId) ??
    byRecording.get(scene.recordingId) ??
    candidateByLabel(scene.cameraId, byLabel, byPosition) ??
    (scene.cameraPosition ? byPosition.get(scene.cameraPosition) : undefined) ??
    candidates[0]!
  );
}

export function repairDirectorReferences(
  decision: VideoEditDecisionV2,
  candidates: DirectorCandidate[],
): VideoEditDecisionV2 {
  const scenes = decision.scenes.map((scene) => {
    const camera = resolveCandidate(scene, candidates);
    return {
      ...scene,
      cameraId: camera.cameraId,
      recordingId: camera.recordingId,
      cameraPosition: camera.cameraPosition,
      cameraRole: camera.cameraRole,
    };
  });
  return { ...decision, scenes };
}

export function validateDirectorReferences(
  decision: VideoEditDecisionV2,
  candidates: DirectorCandidate[],
) {
  const cameras = new Set(candidates.map((item) => item.cameraId));
  const recordings = new Set(candidates.map((item) => item.recordingId));
  for (const scene of decision.scenes) {
    if (!cameras.has(scene.cameraId) || !recordings.has(scene.recordingId)) {
      throw new Error('DIRECTOR_INVALID_REFERENCE');
    }
  }
}

function motionFromScene(scene: SceneDecisionV2): ReelPlanScene['motion'] {
  if (scene.shotStyle === 'punch_in') return 'punch';
  if (
    scene.shotStyle === 'slow_push' ||
    scene.shotStyle === 'cinematic_food_closeup' ||
    scene.shotStyle === 'hero_reveal'
  )
    return 'drift';
  return 'none';
}

function transitionFromScene(scene: SceneDecisionV2) {
  if (scene.transitionOut === 'soft_dissolve') return 'dissolve';
  if (scene.transitionOut === 'dip_to_black') return 'fadeblack';
  return 'cut';
}

export function resolveTimeline(
  decision: VideoEditDecisionV2,
  candidates: DirectorCandidate[],
  plan: ReelPlan,
): ResolvedTimeline {
  validateDirectorReferences(decision, candidates);
  const byCamera = new Map(candidates.map((item) => [item.cameraId, item]));
  const intensity = resolveEditingIntensityProfile(decision.editingIntensity);
  const minMs = Math.round(intensity.targetShotDurationMs * 0.55);
  const maxMs = Math.round(
    intensity.targetShotDurationMs * (decision.editMode === 'single_camera' ? 2.5 : 1.65),
  );

  const scenes: ReelPlanScene[] = decision.scenes.flatMap((scene, index) => {
    const camera = byCamera.get(scene.cameraId);
    if (!camera) return [];
    const windowStartMs = Math.round(camera.startOffsetSeconds * 1000);
    const windowEndMs = windowStartMs + Math.round(camera.windowDurationSeconds * 1000);
    let startMs = Math.max(windowStartMs, scene.sourceStartMs);
    let endMs = Math.min(windowEndMs, scene.sourceEndMs);
    if (endMs - startMs < 800) {
      startMs = windowStartMs;
      endMs = Math.min(windowEndMs, startMs + Math.max(800, minMs));
    }
    const durationMs = Math.min(maxMs, Math.max(minMs, endMs - startMs));
    endMs = Math.min(windowEndMs, startMs + durationMs);
    const duration = Math.max(0.8, (endMs - startMs) / 1000);
    const last = index === decision.scenes.length - 1;
    return [
      {
        camera_id: camera.cameraId,
        recording_id: camera.recordingId,
        source_recording_path: camera.localPath,
        source_start_offset: startMs / 1000,
        duration,
        speed: scene.playbackSpeed ?? 1,
        transition: transitionFromScene(scene),
        reason: `${scene.sceneRole}:${scene.shotStyle}`,
        position: camera.cameraPosition,
        hasAudio: camera.hasAudio,
        role: parseCameraRole(camera.cameraRole) ?? 'master',
        fadeIn: scene.sceneRole === 'hook',
        fadeOut: last,
        punchIn: scene.shotStyle === 'punch_in',
        motion: motionFromScene(scene),
        shotStyle: scene.shotStyle,
        fxAssetId: scene.fxAssetId ?? undefined,
      },
    ];
  });
  if (!scenes.length) throw new Error('DIRECTOR_INVALID_OUTPUT');
  const duration = joinedDuration(
    scenes.map((scene) => ({
      duration: scene.duration,
      transition: scene.transition,
    })),
  );
  return {
    source: 'decision_v2',
    scenes,
    duration: duration || plan.duration,
  };
}

export function sourceSpanSeconds(
  scenes: Array<{ source_start_offset: number; duration: number }>,
) {
  if (!scenes.length) return 0;
  const start = Math.min(...scenes.map((scene) => scene.source_start_offset));
  const end = Math.max(...scenes.map((scene) => scene.source_start_offset + scene.duration));
  return end - start;
}

export function preferExploredSingleCameraTimeline(input: {
  editMode?: string;
  highQualitySource: boolean;
  resolved: ResolvedTimeline;
  playbook: ReelPlan;
  windowDurationSeconds: number;
}): { timeline: ResolvedTimeline; usedPlaybookExploration: boolean } {
  if (input.editMode !== 'single_camera' || !input.highQualitySource) {
    return { timeline: input.resolved, usedPlaybookExploration: false };
  }
  if (input.playbook.scenes.length < 4) {
    return { timeline: input.resolved, usedPlaybookExploration: false };
  }
  const window = Math.max(1, input.windowDurationSeconds);
  const resolvedSpan = sourceSpanSeconds(input.resolved.scenes);
  const directorScenes = input.resolved.scenes.length;
  const overlong =
    input.playbook.duration > 0 && input.resolved.duration > input.playbook.duration * 1.3;
  if (directorScenes >= 4 && resolvedSpan >= window * 0.45 && !overlong) {
    return { timeline: input.resolved, usedPlaybookExploration: false };
  }
  if (directorScenes < 4 || resolvedSpan < window * 0.45 || overlong) {
    return {
      timeline: {
        source: 'decision_v2',
        scenes: input.playbook.scenes,
        duration: input.playbook.duration,
      },
      usedPlaybookExploration: true,
    };
  }
  return { timeline: input.resolved, usedPlaybookExploration: false };
}

export function applyResolvedTimeline(plan: ReelPlan, resolved: ResolvedTimeline): ReelPlan {
  const cropByCamera = new Map<string, Pick<ReelPlanScene, 'crop' | 'cropMode' | 'cropTight'>>();
  for (const scene of plan.scenes) {
    if (!scene.crop) continue;
    cropByCamera.set(scene.camera_id, {
      crop: scene.crop,
      cropMode: scene.cropMode,
      cropTight: scene.cropTight,
    });
  }
  const scenes = resolved.scenes.map((scene) => {
    const crop = cropByCamera.get(scene.camera_id);
    if (!crop || scene.crop) return scene;
    return { ...scene, ...crop };
  });
  const audio = plan.audio ? { ...plan.audio, duration: resolved.duration } : undefined;
  return {
    ...plan,
    scenes,
    duration: resolved.duration,
    audio,
  };
}
