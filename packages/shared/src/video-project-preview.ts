import {
  activeSequence,
  clipAtPlayhead,
  sourceTimeForClip,
  type ClipTransform,
  type ProjectClip,
  type TransitionType,
  type VideoProject,
} from './video-project.js';

export type ProjectPreviewLayer = {
  clip: ProjectClip;
  sourceTimeMs: number;
  opacity: number;
  scale: number;
  transform: ClipTransform;
};

export type ProjectPreviewFrame = {
  timeMs: number;
  durationMs: number;
  outgoing: ProjectPreviewLayer | null;
  incoming: ProjectPreviewLayer | null;
  mix: number;
  fadeBlack: number;
  fadeWhite: number;
  transition?: TransitionType;
  captions: string[];
};

function smoothstep(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function layerFromClip(clip: ProjectClip, timeMs: number, opacity: number): ProjectPreviewLayer {
  const local = Math.max(0, timeMs - clip.timelineStartMs);
  const duration = Math.max(1, clip.timelineEndMs - clip.timelineStartMs);
  let scale = clip.transform.scale;
  if (clip.motion === 'slow_push' || clip.motion === 'zoom_in' || clip.motion === 'ken_burns') {
    scale = clip.transform.scale * (1 + 0.08 * (local / duration));
  } else if (clip.motion === 'zoom_out') {
    scale = clip.transform.scale * (1.08 - 0.08 * (local / duration));
  }
  let fade = opacity * clip.transform.opacity;
  if (clip.fadeInMs > 0 && local < clip.fadeInMs) fade *= local / clip.fadeInMs;
  if (clip.fadeOutMs > 0 && duration - local < clip.fadeOutMs)
    fade *= (duration - local) / clip.fadeOutMs;
  return {
    clip,
    sourceTimeMs: sourceTimeForClip(clip, timeMs),
    opacity: Math.max(0, Math.min(1, fade)),
    scale,
    transform: clip.transform,
  };
}

export function previewProjectAt(
  project: VideoProject,
  timeMs: number,
): ProjectPreviewFrame | null {
  const sequence = activeSequence(project);
  const video =
    sequence.tracks.find((track) => track.kind === 'video') ??
    sequence.tracks.find((track) => track.kind === 'overlay');
  if (!video) return null;
  const duration = sequence.tracks.reduce((max, track) => {
    return Math.max(max, ...track.clips.map((clip) => clip.timelineEndMs), 0);
  }, 0);
  if (duration <= 0) {
    return {
      timeMs: 0,
      durationMs: 0,
      outgoing: null,
      incoming: null,
      mix: 0,
      fadeBlack: 0,
      fadeWhite: 0,
      captions: [],
    };
  }
  const t = Math.max(0, Math.min(duration, timeMs));
  const clips = video.clips
    .filter((clip) => !clip.disabled)
    .sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  const outgoing = clipAtPlayhead(video, t);
  const next = outgoing
    ? (clips.find((clip) => clip.timelineStartMs === outgoing.timelineEndMs) ??
      clips.find((clip) => clip.timelineStartMs > outgoing.timelineStartMs))
    : null;
  const overlap =
    next?.transitionIn && next.transitionIn.type !== 'cut' ? next.transitionIn.durationMs : 0;
  const inOverlap = Boolean(
    outgoing &&
    next &&
    overlap > 0 &&
    t >= next.timelineStartMs - overlap &&
    t < next.timelineStartMs,
  );
  const incomingClip = inOverlap ? next : t >= (next?.timelineStartMs ?? Infinity) ? next : null;
  let mix = 0;
  let fadeBlack = 0;
  let fadeWhite = 0;
  if (inOverlap && next?.transitionIn) {
    const start = next.timelineStartMs - overlap;
    const p = Math.max(0, Math.min(1, (t - start) / overlap));
    const type = next.transitionIn.type;
    if (type === 'cross_dissolve' || type === 'fade' || type === 'blur' || type === 'zoom')
      mix = smoothstep(p);
    else if (type === 'dip_to_black') {
      fadeBlack = p < 0.5 ? smoothstep(p * 2) : smoothstep((1 - p) * 2);
      mix = p < 0.5 ? 0 : smoothstep((p - 0.5) * 2);
    } else if (type === 'dip_to_white' || type === 'flash') {
      fadeWhite = p < 0.5 ? smoothstep(p * 2) : smoothstep((1 - p) * 2);
      mix = p < 0.5 ? 0 : smoothstep((p - 0.5) * 2);
    } else mix = p >= 0.5 ? 1 : 0;
  }

  return {
    timeMs: t,
    durationMs: duration,
    outgoing: outgoing ? layerFromClip(outgoing, t, 1 - mix) : null,
    incoming:
      incomingClip && incomingClip !== outgoing
        ? layerFromClip(incomingClip, t, mix || (inOverlap ? mix : 1))
        : null,
    mix,
    fadeBlack,
    fadeWhite,
    transition: inOverlap ? next?.transitionIn?.type : undefined,
    captions: project.captions
      .filter((cue) => t >= cue.startMs && t < cue.endMs)
      .map((cue) => cue.text),
  };
}
