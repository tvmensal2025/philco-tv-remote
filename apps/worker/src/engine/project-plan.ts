import { compileErrorMessage, type CompiledRenderGraph } from '@reelops/shared';
import type { ClipCandidate } from '../adapters/analyzer.js';
import type { ReelPlan, ReelPlanScene } from './planner.js';
import { joinedDuration } from '../pipeline/finish.js';

export function applyCompiledGraph(
  plan: ReelPlan,
  graph: CompiledRenderGraph,
  clips: ClipCandidate[],
): ReelPlan {
  const error = compileErrorMessage(graph);
  if (error) throw new Error(`INPUT_ERROR:${error}`);
  const byRecording = new Map(clips.map((clip) => [clip.recordingId, clip]));
  const byCamera = new Map(clips.map((clip) => [clip.cameraId, clip]));
  const scenes: ReelPlanScene[] = graph.scenes.map((scene, index) => {
    const clip =
      (scene.recordingId ? byRecording.get(scene.recordingId) : undefined) ??
      (scene.cameraId ? byCamera.get(scene.cameraId) : undefined) ??
      clips.find((item) => item.position === scene.cameraPosition) ??
      clips[0];
    if (!clip)
      throw new Error(`Export failed at clip ${scene.clipId}. Reason: source media unavailable`);
    return {
      camera_id: clip.cameraId,
      recording_id: clip.recordingId,
      source_recording_path: clip.localPath,
      source_start_offset: scene.sourceStartSeconds,
      duration: scene.durationSeconds,
      speed: scene.speed,
      transition: scene.transition,
      reason: scene.reason ?? `editor:${index + 1}`,
      position: clip.position,
      hasAudio: clip.hasAudio && !scene.muted && !graph.originalAudioMuted,
      role: clip.role ?? 'master',
      fadeIn: scene.fadeIn,
      fadeOut: scene.fadeOut,
      punchIn: scene.punchIn,
      motion: scene.motion,
      fxAssetId: scene.fxAssetId,
      crop: scene.crop,
      cropMode: scene.cropMode,
    };
  });
  if (!scenes.length) throw new Error('Export failed. Reason: timeline has no video clips');
  return {
    ...plan,
    scenes,
    duration:
      graph.durationSeconds ||
      joinedDuration(
        scenes.map((scene) => ({ duration: scene.duration, transition: scene.transition })),
      ),
    audio: graph.originalAudioMuted
      ? undefined
      : plan.audio
        ? { ...plan.audio, duration: graph.durationSeconds }
        : plan.audio,
  };
}
