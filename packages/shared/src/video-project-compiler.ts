import {
  activeSequence,
  clipDurationMs,
  sequenceDurationMs,
  type TransitionType,
  type VideoProject,
} from './video-project.js';

export type CompiledScene = {
  clipId: string;
  mediaId: string | null;
  recordingId?: string;
  cameraId?: string;
  cameraPosition?: number;
  sourceStartSeconds: number;
  durationSeconds: number;
  speed: number;
  transition: 'cut' | 'dissolve' | 'fadeblack';
  transitionType: TransitionType;
  fxAssetId?: string;
  motion: 'none' | 'drift' | 'punch';
  punchIn: boolean;
  fadeIn: boolean;
  fadeOut: boolean;
  volume: number;
  muted: boolean;
  lockedByUser: boolean;
  reason?: string;
  scale: number;
  opacity: number;
  crop?: [number, number, number, number];
  cropMode?: 'crop' | 'pad_blur';
};

export type CompiledRenderGraph = {
  projectId: string;
  projectVersion: number;
  program?: VideoProject['program'];
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  aspect: VideoProject['settings']['aspect'];
  scenes: CompiledScene[];
  originalAudioMuted: boolean;
  captions: Array<{ startSeconds: number; endSeconds: number; text: string }>;
  branding: VideoProject['branding'];
};

function ffmpegJoin(type: TransitionType | undefined): 'cut' | 'dissolve' | 'fadeblack' {
  if (!type || type === 'cut') return 'cut';
  if (type === 'dip_to_black' || type === 'fade') return 'fadeblack';
  return 'dissolve';
}

function ffmpegMotion(
  motion: VideoProject['sequences'][0]['tracks'][0]['clips'][0]['motion'],
): CompiledScene['motion'] {
  if (motion === 'slow_push' || motion === 'zoom_in' || motion === 'ken_burns') return 'drift';
  if (motion === 'zoom_out' || motion === 'dynamic_crop') return 'punch';
  return 'none';
}

export function compileVideoProject(project: VideoProject): CompiledRenderGraph {
  const sequence = activeSequence(project);
  const videoTrack =
    sequence.tracks.find((track) => track.kind === 'video' && track.clips.length) ??
    sequence.tracks.find((track) => track.kind === 'video');
  const clips = (videoTrack?.clips ?? [])
    .filter((clip) => !clip.disabled)
    .sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  const originalTrack = sequence.tracks.find((track) => track.id === 'track_a1');
  const scenes: CompiledScene[] = clips.map((clip, index) => {
    const media = project.media.find((item) => item.id === clip.mediaId);
    const durationSeconds = clipDurationMs(clip) / 1000;
    const sourceSeconds = (clip.sourceOutMs - clip.sourceInMs) / 1000;
    const frameW = media?.width && media.width > 0 ? media.width : 1920;
    const frameH = media?.height && media.height > 0 ? media.height : 1080;
    const cropBox = clip.transform.crop;
    const crop: [number, number, number, number] | undefined = cropBox
      ? [
          Math.round(cropBox.x * frameW),
          Math.round(cropBox.y * frameH),
          Math.round(cropBox.width * frameW),
          Math.round(cropBox.height * frameH),
        ]
      : undefined;
    return {
      clipId: clip.id,
      mediaId: clip.mediaId,
      recordingId: media?.recordingId,
      cameraId: media?.cameraId,
      cameraPosition: media?.cameraPosition,
      sourceStartSeconds: clip.sourceInMs / 1000,
      durationSeconds: Number((clip.speed !== 1 ? durationSeconds : sourceSeconds).toFixed(3)),
      speed: clip.speed,
      transition: ffmpegJoin(clip.transitionIn?.type),
      transitionType: clip.transitionIn?.type ?? 'cut',
      fxAssetId: clip.transitionIn?.fxAssetId ?? undefined,
      motion: ffmpegMotion(clip.motion),
      punchIn: clip.motion === 'zoom_in' || clip.transform.scale > 1.04,
      fadeIn: clip.fadeInMs > 0 || index === 0,
      fadeOut: clip.fadeOutMs > 0 || index === clips.length - 1,
      volume: originalTrack?.muted || clip.muted ? 0 : clip.volume,
      muted: Boolean(originalTrack?.muted || clip.muted),
      lockedByUser: clip.lockedByUser,
      reason: clip.ai?.reason,
      scale: clip.transform.scale,
      opacity: clip.transform.opacity,
      crop,
      cropMode: crop ? 'crop' : undefined,
    };
  });

  return {
    projectId: project.id,
    projectVersion: project.projectVersion,
    program: project.program,
    durationSeconds: Number((sequenceDurationMs(sequence) / 1000).toFixed(3)),
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
    aspect: project.settings.aspect,
    scenes,
    originalAudioMuted: Boolean(originalTrack?.muted) || scenes.every((scene) => scene.muted),
    captions: project.captions.map((cue) => ({
      startSeconds: cue.startMs / 1000,
      endSeconds: cue.endMs / 1000,
      text: cue.text,
    })),
    branding: project.branding,
  };
}

export function compileErrorMessage(graph: CompiledRenderGraph) {
  const missing = graph.scenes.find((scene) => !scene.mediaId && !scene.recordingId);
  if (missing) return `Export failed at clip ${missing.clipId}. Reason: source media unavailable`;
  if (!graph.scenes.length) return 'Export failed. Reason: timeline has no video clips';
  return null;
}
