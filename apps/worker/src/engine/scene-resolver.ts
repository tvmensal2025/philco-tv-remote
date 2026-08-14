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

const LABEL = /^c(?:amera)?[\s_-]?(\d{1,2})$/i;

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

export function repairDirectorReferences(
  decision: VideoEditDecisionV2,
  candidates: DirectorCandidate[],
): VideoEditDecisionV2 {
  const byCamera = new Map(candidates.map((item) => [item.cameraId, item]));
  const byRecording = new Set(candidates.map((item) => item.recordingId));
  const byPosition = new Map(candidates.map((item) => [item.cameraPosition, item]));
  const byLabel = new Map(candidates.map((item) => [item.cameraLabel.toLowerCase(), item]));

  const scenes = decision.scenes.map((scene) => {
    let camera = byCamera.get(scene.cameraId);
    if (!camera) {
      const labelMatch = String(scene.cameraId).match(LABEL);
      if (!labelMatch) throw new Error('DIRECTOR_INVALID_REFERENCE');
      camera = byLabel.get(`c${labelMatch[1]}`) ?? byPosition.get(Number(labelMatch[1]));
    }
    if (!camera) throw new Error('DIRECTOR_INVALID_REFERENCE');
    const recordingId = byRecording.has(scene.recordingId) ? scene.recordingId : camera.recordingId;
    if (!byRecording.has(recordingId)) throw new Error('DIRECTOR_INVALID_REFERENCE');
    return {
      ...scene,
      cameraId: camera.cameraId,
      recordingId,
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
  const maxMs = Math.round(intensity.targetShotDurationMs * 1.65);

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
        speed: 1,
        transition: transitionFromScene(scene),
        reason: `${scene.sceneRole}:${scene.shotStyle}`,
        position: camera.cameraPosition,
        hasAudio: camera.hasAudio,
        role: parseCameraRole(camera.cameraRole) ?? 'master',
        fadeIn: scene.sceneRole === 'hook',
        fadeOut: last,
        punchIn: scene.shotStyle === 'punch_in',
        motion: motionFromScene(scene),
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

export function applyResolvedTimeline(plan: ReelPlan, resolved: ResolvedTimeline): ReelPlan {
  const audio = plan.audio ? { ...plan.audio, duration: resolved.duration } : undefined;
  return {
    ...plan,
    scenes: resolved.scenes,
    duration: resolved.duration,
    audio,
  };
}
