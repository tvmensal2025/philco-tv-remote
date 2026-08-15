import {
  activeSequence,
  clipDurationMs,
  cloneProject,
  createEntityId,
  emptyColor,
  emptyTransform,
  sequenceDurationMs,
  snapMsToFrame,
  sourceDurationMs,
  type ProjectClip,
  type TimelineTrack,
  type TransitionType,
  type VideoProject,
} from './video-project.js';

export const MIN_CLIP_MS = 200;

export type HistoryStack = {
  past: VideoProject[];
  future: VideoProject[];
};

export function createHistory(): HistoryStack {
  return { past: [], future: [] };
}

export function pushHistory(history: HistoryStack, previous: VideoProject): HistoryStack {
  return {
    past: [...history.past.slice(-79), cloneProject(previous)],
    future: [],
  };
}

export function undoProject(
  current: VideoProject,
  history: HistoryStack,
): { project: VideoProject; history: HistoryStack } | null {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return {
    project: cloneProject(previous),
    history: {
      past: history.past.slice(0, -1),
      future: [cloneProject(current), ...history.future].slice(0, 80),
    },
  };
}

export function redoProject(
  current: VideoProject,
  history: HistoryStack,
): { project: VideoProject; history: HistoryStack } | null {
  const next = history.future[0];
  if (!next) return null;
  return {
    project: cloneProject(next),
    history: {
      past: [...history.past, cloneProject(current)].slice(-80),
      future: history.future.slice(1),
    },
  };
}

function withSequence(project: VideoProject, tracks: TimelineTrack[]): VideoProject {
  const sequence = activeSequence(project);
  return {
    ...project,
    sequences: [{ ...sequence, tracks }, ...project.sequences.slice(1)],
    updatedAt: new Date().toISOString(),
  };
}

function mapTrack(
  project: VideoProject,
  trackId: string,
  mapper: (track: TimelineTrack) => TimelineTrack,
): VideoProject {
  const sequence = activeSequence(project);
  return withSequence(
    project,
    sequence.tracks.map((track) => (track.id === trackId ? mapper(track) : track)),
  );
}

function assertUnlocked(track: TimelineTrack, clip?: ProjectClip) {
  if (track.locked) throw new Error('TRACK_LOCKED');
  if (clip?.lockedByUser) throw new Error('CLIP_LOCKED');
}

export function makeVideoClip(input: {
  mediaId: string;
  name?: string;
  sourceInMs?: number;
  sourceOutMs: number;
  timelineStartMs?: number;
  speed?: number;
  ai?: ProjectClip['ai'];
}): ProjectClip {
  const sourceInMs = input.sourceInMs ?? 0;
  const sourceOutMs = Math.max(sourceInMs + MIN_CLIP_MS, input.sourceOutMs);
  const start = input.timelineStartMs ?? 0;
  const duration = Math.round((sourceOutMs - sourceInMs) / (input.speed ?? 1));
  return {
    id: createEntityId('clip'),
    mediaId: input.mediaId,
    name: input.name ?? 'Clip',
    kind: 'video',
    sourceInMs,
    sourceOutMs,
    timelineStartMs: start,
    timelineEndMs: start + duration,
    speed: input.speed ?? 1,
    reverse: false,
    volume: 1,
    muted: false,
    fadeInMs: 0,
    fadeOutMs: 0,
    pan: 0,
    transform: emptyTransform(),
    color: emptyColor(),
    motion: 'none',
    effects: [],
    lockedByUser: false,
    disabled: false,
    ai: input.ai,
  };
}

export function appendClipToTrack(
  project: VideoProject,
  trackId: string,
  clip: ProjectClip,
): VideoProject {
  return mapTrack(project, trackId, (track) => {
    assertUnlocked(track);
    const end = track.clips.reduce((max, item) => Math.max(max, item.timelineEndMs), 0);
    const duration = clipDurationMs(clip);
    const placed: ProjectClip = {
      ...clip,
      timelineStartMs: end,
      timelineEndMs: end + duration,
    };
    return { ...track, clips: [...track.clips, placed] };
  });
}

export function insertClipAt(
  project: VideoProject,
  trackId: string,
  clip: ProjectClip,
  timelineStartMs: number,
): VideoProject {
  return mapTrack(project, trackId, (track) => {
    assertUnlocked(track);
    const duration = clipDurationMs(clip);
    const start = Math.max(0, timelineStartMs);
    const placed: ProjectClip = {
      ...clip,
      timelineStartMs: start,
      timelineEndMs: start + duration,
    };
    return {
      ...track,
      clips: [...track.clips, placed].sort((a, b) => a.timelineStartMs - b.timelineStartMs),
    };
  });
}

export function splitClipAtPlayhead(
  project: VideoProject,
  clipId: string,
  timeMs: number,
): VideoProject | null {
  const fps = project.settings.fps;
  const snapped = snapMsToFrame(timeMs, fps);
  const sequence = activeSequence(project);
  let changed = false;
  const tracks = sequence.tracks.map((track) => {
    const index = track.clips.findIndex((clip) => clip.id === clipId);
    if (index < 0) return track;
    const clip = track.clips[index]!;
    if (track.locked || clip.lockedByUser) return track;
    if (
      snapped <= clip.timelineStartMs + MIN_CLIP_MS ||
      snapped >= clip.timelineEndMs - MIN_CLIP_MS
    ) {
      return track;
    }
    const leftDur = snapped - clip.timelineStartMs;
    const sourceSpan = sourceDurationMs(clip);
    const timelineSpan = clipDurationMs(clip);
    const cut = clip.reverse
      ? clip.sourceOutMs - Math.round((leftDur / timelineSpan) * sourceSpan)
      : clip.sourceInMs + Math.round((leftDur / timelineSpan) * sourceSpan);
    const left: ProjectClip = {
      ...clip,
      sourceOutMs: clip.reverse ? clip.sourceOutMs : cut,
      sourceInMs: clip.reverse ? cut : clip.sourceInMs,
      timelineEndMs: snapped,
      transitionIn: clip.transitionIn,
    };
    const right: ProjectClip = {
      ...clip,
      id: createEntityId('clip'),
      name: `${clip.name}-b`.slice(0, 120),
      sourceInMs: clip.reverse ? clip.sourceInMs : cut,
      sourceOutMs: clip.reverse ? cut : clip.sourceOutMs,
      timelineStartMs: snapped,
      timelineEndMs: clip.timelineEndMs,
      transitionIn: undefined,
      linkedClipId: clip.linkedClipId,
    };
    if (sourceDurationMs(left) < MIN_CLIP_MS || sourceDurationMs(right) < MIN_CLIP_MS) return track;
    changed = true;
    const clips = [...track.clips];
    clips.splice(index, 1, left, right);
    return { ...track, clips };
  });
  if (!changed) return null;
  return withSequence(project, tracks);
}

export function trimClip(
  project: VideoProject,
  clipId: string,
  edge: 'left' | 'right',
  nextTimeMs: number,
): VideoProject | null {
  const fps = project.settings.fps;
  const snapped = snapMsToFrame(nextTimeMs, fps);
  const sequence = activeSequence(project);
  let changed = false;
  const tracks = sequence.tracks.map((track) => {
    const clip = track.clips.find((item) => item.id === clipId);
    if (!clip || track.locked || clip.lockedByUser) return track;
    const media = project.media.find((item) => item.id === clip.mediaId);
    const maxSource =
      media?.durationMs && media.durationMs > 0 ? media.durationMs : clip.sourceOutMs + 600_000;
    if (edge === 'left') {
      const maxStart = clip.timelineEndMs - MIN_CLIP_MS;
      const start = Math.max(0, Math.min(maxStart, snapped));
      const delta = start - clip.timelineStartMs;
      const sourceIn = Math.max(
        0,
        Math.min(clip.sourceOutMs - MIN_CLIP_MS, clip.sourceInMs + delta),
      );
      if (start === clip.timelineStartMs) return track;
      changed = true;
      return {
        ...track,
        clips: track.clips.map((item) =>
          item.id === clipId ? { ...item, timelineStartMs: start, sourceInMs: sourceIn } : item,
        ),
      };
    }
    const minEnd = clip.timelineStartMs + MIN_CLIP_MS;
    const end = Math.max(minEnd, snapped);
    const delta = end - clip.timelineEndMs;
    const sourceOut = Math.max(
      clip.sourceInMs + MIN_CLIP_MS,
      Math.min(maxSource, clip.sourceOutMs + delta),
    );
    if (end === clip.timelineEndMs) return track;
    changed = true;
    return {
      ...track,
      clips: track.clips.map((item) =>
        item.id === clipId ? { ...item, timelineEndMs: end, sourceOutMs: sourceOut } : item,
      ),
    };
  });
  if (!changed) return null;
  return withSequence(project, tracks);
}

export function deleteClip(
  project: VideoProject,
  clipId: string,
  ripple = false,
): VideoProject | null {
  const sequence = activeSequence(project);
  let removed: ProjectClip | undefined;
  let trackId = '';
  for (const track of sequence.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip && !track.locked && !clip.lockedByUser) {
      removed = clip;
      trackId = track.id;
      break;
    }
  }
  if (!removed) return null;
  const gap = clipDurationMs(removed);
  const start = removed.timelineStartMs;
  const tracks = sequence.tracks.map((track) => {
    if (track.id !== trackId) return track;
    const remaining = track.clips.filter((item) => item.id !== clipId);
    if (!ripple) return { ...track, clips: remaining };
    return {
      ...track,
      clips: remaining.map((clip) =>
        clip.timelineStartMs >= start
          ? {
              ...clip,
              timelineStartMs: clip.timelineStartMs - gap,
              timelineEndMs: clip.timelineEndMs - gap,
            }
          : clip,
      ),
    };
  });
  return withSequence(project, tracks);
}

export function moveClip(
  project: VideoProject,
  clipId: string,
  timelineStartMs: number,
  targetTrackId?: string,
): VideoProject | null {
  const fps = project.settings.fps;
  const snapped = snapMsToFrame(Math.max(0, timelineStartMs), fps);
  const sequence = activeSequence(project);
  let moving: ProjectClip | null = null;
  let fromTrack: TimelineTrack | null = null;
  for (const track of sequence.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) {
      moving = clip;
      fromTrack = track;
      break;
    }
  }
  if (!moving || !fromTrack || fromTrack.locked || moving.lockedByUser) return null;
  const duration = clipDurationMs(moving);
  const destId = targetTrackId ?? fromTrack.id;
  const dest = sequence.tracks.find((track) => track.id === destId);
  if (!dest || dest.locked) return null;
  if (dest.kind !== fromTrack.kind && !(fromTrack.kind === 'video' && dest.kind === 'overlay')) {
    return null;
  }
  const placed: ProjectClip = {
    ...moving,
    timelineStartMs: snapped,
    timelineEndMs: snapped + duration,
  };
  const tracks = sequence.tracks.map((track) => {
    if (track.id === fromTrack!.id && track.id === destId) {
      return {
        ...track,
        clips: track.clips
          .map((clip) => (clip.id === clipId ? placed : clip))
          .sort((a, b) => a.timelineStartMs - b.timelineStartMs),
      };
    }
    if (track.id === fromTrack!.id) {
      return { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) };
    }
    if (track.id === destId) {
      return {
        ...track,
        clips: [...track.clips, placed].sort((a, b) => a.timelineStartMs - b.timelineStartMs),
      };
    }
    return track;
  });
  return withSequence(project, tracks);
}

export function duplicateClip(project: VideoProject, clipId: string): VideoProject | null {
  const sequence = activeSequence(project);
  let copied = false;
  const tracks = sequence.tracks.map((track) => {
    const clip = track.clips.find((item) => item.id === clipId);
    if (!clip || track.locked) return track;
    copied = true;
    const duration = clipDurationMs(clip);
    const clone: ProjectClip = {
      ...structuredClone(clip),
      id: createEntityId('clip'),
      name: `${clip.name}-copy`.slice(0, 120),
      timelineStartMs: clip.timelineEndMs,
      timelineEndMs: clip.timelineEndMs + duration,
      lockedByUser: false,
    };
    return { ...track, clips: [...track.clips, clone] };
  });
  if (!copied) return null;
  return withSequence(project, tracks);
}

export function setClipLocked(
  project: VideoProject,
  clipId: string,
  locked: boolean,
): VideoProject {
  const sequence = activeSequence(project);
  return withSequence(
    project,
    sequence.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) =>
        clip.id === clipId ? { ...clip, lockedByUser: locked } : clip,
      ),
    })),
  );
}

export function patchClip(
  project: VideoProject,
  clipId: string,
  patch: Partial<ProjectClip>,
): VideoProject | null {
  const sequence = activeSequence(project);
  let found = false;
  const tracks = sequence.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      if (track.locked || clip.lockedByUser) return clip;
      found = true;
      return { ...clip, ...patch, id: clip.id };
    }),
  }));
  if (!found) return null;
  return withSequence(project, tracks);
}

export function setClipVolume(project: VideoProject, clipId: string, volume: number) {
  return patchClip(project, clipId, { volume: Math.max(0, Math.min(2, volume)) });
}

export function muteClip(project: VideoProject, clipId: string, muted: boolean) {
  return patchClip(project, clipId, { muted });
}

export function muteTrack(project: VideoProject, trackId: string, muted: boolean) {
  return mapTrack(project, trackId, (track) => ({ ...track, muted }));
}

export function setTransitionIn(
  project: VideoProject,
  clipId: string,
  type: TransitionType | null,
  durationMs = 400,
): VideoProject | null {
  if (!type || type === 'cut') return patchClip(project, clipId, { transitionIn: undefined });
  return patchClip(project, clipId, {
    transitionIn: { type, durationMs, easing: 'ease', intensity: 1 },
  });
}

export function detachAudio(project: VideoProject, clipId: string): VideoProject | null {
  const sequence = activeSequence(project);
  let source: ProjectClip | null = null;
  for (const track of sequence.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip?.kind === 'video') {
      source = clip;
      break;
    }
  }
  if (!source || !source.mediaId) return null;
  const audioTrack = sequence.tracks.find(
    (track) => track.id === 'track_a1' || track.kind === 'audio',
  );
  if (!audioTrack || audioTrack.locked) return null;
  const audioClip: ProjectClip = {
    ...source,
    id: createEntityId('clip'),
    kind: 'audio',
    name: `${source.name} áudio`,
    linkedClipId: source.id,
    transform: emptyTransform(),
    color: emptyColor(),
    motion: 'none',
    effects: [],
    transitionIn: undefined,
    text: undefined,
    lockedByUser: false,
  };
  const mutedVideo = patchClip(project, source.id, { muted: true, linkedClipId: audioClip.id });
  if (!mutedVideo) return null;
  return mapTrack(mutedVideo, audioTrack.id, (track) => ({
    ...track,
    clips: [...track.clips, audioClip].sort((a, b) => a.timelineStartMs - b.timelineStartMs),
  }));
}

export function snapTimeMs(project: VideoProject, timeMs: number, thresholdMs = 120) {
  const sequence = activeSequence(project);
  const duration = sequenceDurationMs(sequence);
  const candidates: Array<{ time: number; weight: number }> = [
    { time: 0, weight: 1 },
    { time: duration, weight: 1 },
  ];
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      candidates.push(
        { time: clip.timelineStartMs, weight: 1 },
        { time: clip.timelineEndMs, weight: 1 },
      );
    }
  }
  for (const marker of sequence.markers) {
    const downbeat = marker.kind === 'beat' && Boolean(marker.label);
    const section = marker.kind === 'highlight';
    const weight = downbeat ? 0.62 : section ? 0.72 : marker.kind === 'beat' ? 0.85 : 1;
    candidates.push({ time: marker.timeMs, weight });
  }
  let best = Math.max(0, timeMs);
  let bestScore = thresholdMs;
  for (const candidate of candidates) {
    const score = Math.abs(candidate.time - timeMs) * candidate.weight;
    if (score < bestScore) {
      best = candidate.time;
      bestScore = score;
    }
  }
  return snapMsToFrame(best, project.settings.fps);
}

export function addMediaAndClip(
  project: VideoProject,
  media: VideoProject['media'][number],
  options?: {
    trackId?: string;
    timelineStartMs?: number;
    sourceInMs?: number;
    sourceOutMs?: number;
  },
): VideoProject {
  const withMedia: VideoProject = {
    ...project,
    media: project.media.some((item) => item.id === media.id)
      ? project.media
      : [...project.media, media],
  };
  const trackId = options?.trackId ?? (media.kind === 'audio' ? 'track_a3' : 'track_v1');
  const sourceOut = options?.sourceOutMs ?? media.durationMs ?? MIN_CLIP_MS;
  const clip = makeVideoClip({
    mediaId: media.id,
    name: media.name,
    sourceInMs: options?.sourceInMs ?? 0,
    sourceOutMs: Math.max(MIN_CLIP_MS, sourceOut),
    timelineStartMs: options?.timelineStartMs ?? sequenceDurationMs(activeSequence(withMedia)),
  });
  if (media.kind === 'audio') clip.kind = 'audio';
  return insertClipAt(withMedia, trackId, clip, clip.timelineStartMs);
}

export function preserveLockedClips(current: VideoProject, incoming: VideoProject): VideoProject {
  const locked = new Map<string, ProjectClip>();
  for (const track of activeSequence(current).tracks) {
    for (const clip of track.clips) {
      if (clip.lockedByUser) locked.set(clip.id, clip);
    }
  }
  if (!locked.size) return incoming;
  const sequence = activeSequence(incoming);
  const tracks = sequence.tracks.map((track) => {
    const currentTrack = activeSequence(current).tracks.find((item) => item.id === track.id);
    const lockedHere = currentTrack?.clips.filter((clip) => clip.lockedByUser) ?? [];
    if (!lockedHere.length) return track;
    const unlocked = track.clips.filter((clip) => !locked.has(clip.id));
    return {
      ...track,
      clips: [...lockedHere, ...unlocked].sort((a, b) => a.timelineStartMs - b.timelineStartMs),
    };
  });
  return {
    ...incoming,
    sequences: [{ ...sequence, tracks }, ...incoming.sequences.slice(1)],
    ai: {
      mode: incoming.ai?.mode ?? current.ai?.mode ?? 'balanced',
      decisions: [
        ...(incoming.ai?.decisions ?? []),
        ...[...locked.values()].map((clip) => ({
          id: createEntityId('dec'),
          atMs: clip.timelineStartMs,
          kind: 'lock_preserve' as const,
          clipId: clip.id,
          mediaId: clip.mediaId ?? undefined,
          reason: 'Edição manual bloqueada — a IA não alterou este clip',
        })),
      ],
      unusedMediaIds: incoming.ai?.unusedMediaIds ?? [],
      quality: incoming.ai?.quality,
      renderFromProject: true,
    },
  };
}
