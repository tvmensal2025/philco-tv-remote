import type {
  JoinOverlayKind,
  PlaybookBeat,
  ProgramBranding,
  ProgramPresetSpec,
} from './program-preset.js';
import {
  JOIN_DEFAULT_SECONDS,
  JOIN_OVERLAY,
  brandingLayerLabels,
  emptyProgramBranding,
  joinLabels,
  joinOverlayLabels,
  motionLabels,
  resolvedJoinOverlay,
} from './program-preset.js';

export const FACTORY_LIMITS = {
  minTakes: 3,
  maxTakes: 12,
  minBeatSeconds: 0.8,
  maxBeatSeconds: 12,
  captionSeconds: 8,
  fadeInSeconds: 0.7,
  fadeOutSeconds: 0.85,
  punchZoom: 0.11,
  driftZoom: 0.07,
  punchInScale: 1240 / 1080,
  audioFadeInSeconds: 0.55,
  audioFadeOutSeconds: 0.8,
  frameWidth: 1080,
  frameHeight: 1920,
} as const;

export const FACTORY_BRANDING = {
  logo: { x: 90, y: 250, size: 72 },
  title: { y: 360, fontSize: 72, start: 1.6, duration: 2.2 },
  lowerThird: { x: 90, bottom: 360, fontSize: 40, start: 1.2, duration: 6.5 },
  cta: { bottom: 280, fontSize: 48, tail: 4 },
  endCard: { duration: 1.55, fontSize: 70 },
  wordmarkFontSize: 28,
} as const;

export type BrandingPreview = {
  title: boolean;
  logo: boolean;
  lowerThird: boolean;
  cta: boolean;
  endCard: boolean;
};

export function brandingPreviewAt(
  branding: ProgramBranding,
  time: number,
  duration: number,
): BrandingPreview {
  const t = Math.max(0, Math.min(duration, time));
  const endStart = Math.max(0, duration - FACTORY_BRANDING.endCard.duration);
  const onEnd = branding.endCard && t >= endStart;
  return {
    title:
      branding.title &&
      !onEnd &&
      t >= FACTORY_BRANDING.title.start &&
      t < FACTORY_BRANDING.title.start + FACTORY_BRANDING.title.duration,
    logo: branding.logo && t <= duration,
    lowerThird:
      branding.lowerThird &&
      !onEnd &&
      t >= FACTORY_BRANDING.lowerThird.start &&
      t < FACTORY_BRANDING.lowerThird.start + FACTORY_BRANDING.lowerThird.duration,
    cta: branding.cta && !onEnd && t >= Math.max(0, duration - FACTORY_BRANDING.cta.tail),
    endCard: onEnd,
  };
}

export type TimelineClip = {
  index: number;
  start: number;
  end: number;
  duration: number;
  joinOverlap: number;
  beat: PlaybookBeat;
};

export type PreviewLayer = {
  clipIndex: number;
  localTime: number;
  scale: number;
  opacity: number;
  beat: PlaybookBeat;
};

export type PreviewFrame = {
  time: number;
  duration: number;
  outgoing: PreviewLayer;
  incoming: PreviewLayer | null;
  mix: number;
  fadeBlack: number;
  programFade: number;
  captionVisible: boolean;
  branding: BrandingPreview;
  inOverlap: boolean;
  joinOverlay: { name: JoinOverlayKind; opacity: number } | null;
};

export type JoinOverlayHit = {
  clipIndex: number;
  name: JoinOverlayKind;
  start: number;
  end: number;
  duration: number;
};

export function smoothstep(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export function resolvedJoinDuration(beat: PlaybookBeat) {
  const fallback = JOIN_DEFAULT_SECONDS[beat.join];
  const custom = beat.joinDurationSeconds;
  if (typeof custom !== 'number' || !Number.isFinite(custom)) return fallback;
  if (beat.join === 'dissolve') return Math.min(1.5, Math.max(0.4, custom));
  if (beat.join === 'fadeblack') return Math.min(1.5, Math.max(0.35, custom));
  return Math.min(0.2, Math.max(0.02, custom));
}

export function buildProgramTimeline(spec: ProgramPresetSpec): {
  clips: TimelineClip[];
  duration: number;
} {
  const clips: TimelineClip[] = [];
  let cursor = 0;
  spec.beats.forEach((beat, index) => {
    const joinOverlap = index === 0 ? 0 : resolvedJoinDuration(beat);
    const start = index === 0 ? 0 : Math.max(0, cursor - joinOverlap);
    const end = start + beat.durationSeconds;
    clips.push({ index, start, end, duration: beat.durationSeconds, joinOverlap, beat });
    cursor = end;
  });
  return { clips, duration: Number((clips.at(-1)?.end ?? 0).toFixed(3)) };
}

export function joinOverlayHits(spec: ProgramPresetSpec): JoinOverlayHit[] {
  const { clips, duration } = buildProgramTimeline(spec);
  return overlayHitsFromClips(clips, duration);
}

function overlayHitsFromClips(clips: TimelineClip[], duration: number): JoinOverlayHit[] {
  const hits: JoinOverlayHit[] = [];
  for (const clip of clips) {
    if (clip.index === 0) continue;
    const name = resolvedJoinOverlay(clip.beat);
    if (!name) continue;
    const fx = JOIN_OVERLAY[name];
    const center = clip.start + clip.joinOverlap / 2;
    const start = Math.max(0, Number((center - fx.duration / 2).toFixed(3)));
    const end = Math.min(duration, Number((start + fx.duration).toFixed(3)));
    hits.push({
      clipIndex: clip.index,
      name,
      start,
      end,
      duration: Number((end - start).toFixed(3)),
    });
  }
  return hits;
}

function overlayOpacityAt(hit: JoinOverlayHit, time: number) {
  const fx = JOIN_OVERLAY[hit.name];
  const t = time - hit.start;
  if (t < 0 || t > hit.duration) return 0;
  let gain = 1;
  if (t < fx.fadeIn) gain = fx.fadeIn <= 0 ? 1 : t / fx.fadeIn;
  else if (t > fx.duration - fx.fadeOut)
    gain = fx.fadeOut <= 0 ? 0 : (fx.duration - t) / fx.fadeOut;
  return Math.max(0, Math.min(1, gain)) * fx.peak;
}

export function clipAtTime(clips: TimelineClip[], time: number) {
  if (!clips.length) return null;
  const t = Math.max(0, time);
  const inside = clips.find(
    (clip, index) =>
      t >= clip.start && (t < clip.end || (index === clips.length - 1 && t <= clip.end)),
  );
  return inside ?? clips[clips.length - 1]!;
}

export function localTimeInClip(clip: TimelineClip, time: number) {
  return Math.max(0, Math.min(clip.duration, time - clip.start));
}

export function beatScale(beat: PlaybookBeat, localTime: number) {
  const duration = Math.max(FACTORY_LIMITS.minBeatSeconds, beat.durationSeconds);
  const t = Math.max(0, Math.min(duration, localTime));
  const motion =
    beat.motion ?? (beat.punchIn ? 'punch' : beat.roles[0] === 'ambience' ? 'drift' : 'none');
  if (motion === 'punch') return 1 + FACTORY_LIMITS.punchZoom * (t / duration);
  if (motion === 'drift') return 1 + FACTORY_LIMITS.driftZoom * (t / duration);
  if (beat.punchIn) return FACTORY_LIMITS.punchInScale;
  return 1;
}

function fadeInOpacity(beat: PlaybookBeat, localTime: number) {
  if (!beat.fadeIn) return 1;
  return Math.max(0, Math.min(1, localTime / FACTORY_LIMITS.fadeInSeconds));
}

export function previewAtTime(spec: ProgramPresetSpec, time: number): PreviewFrame | null {
  const { clips, duration } = buildProgramTimeline(spec);
  if (!clips.length || duration <= 0) return null;
  const t = Math.max(0, Math.min(duration, time));
  const outgoingClip = clipAtTime(clips, t);
  if (!outgoingClip) return null;
  const next = clips[outgoingClip.index + 1] ?? null;
  const inOverlap = Boolean(next && t >= next.start && t < outgoingClip.end);
  const incomingClip = inOverlap ? next : null;
  const overlapProgress =
    incomingClip && incomingClip.joinOverlap > 0
      ? Math.max(0, Math.min(1, (t - incomingClip.start) / incomingClip.joinOverlap))
      : 0;

  let mix = 0;
  let fadeBlack = 0;
  let under = 1;
  if (incomingClip) {
    const join = incomingClip.beat.join;
    const p = overlapProgress;
    if (join === 'dissolve') {
      mix = smoothstep(p);
    } else if (join === 'cut') {
      mix = p >= 0.5 ? 1 : 0;
    } else {
      fadeBlack = p < 0.5 ? smoothstep(p * 2) : smoothstep((1 - p) * 2);
      mix = p < 0.5 ? 0 : smoothstep((p - 0.5) * 2);
      under = p < 0.5 ? 1 - smoothstep(p * 2) : 0;
    }
  }

  const last = clips[clips.length - 1]!;
  const fadeOut =
    last.beat.fadeOut !== false && duration >= 1.2
      ? Math.max(
          0,
          Math.min(
            1,
            (t - (duration - FACTORY_LIMITS.fadeOutSeconds)) / FACTORY_LIMITS.fadeOutSeconds,
          ),
        )
      : 0;

  const outgoingLocal = localTimeInClip(outgoingClip, t);
  const outgoing: PreviewLayer = {
    clipIndex: outgoingClip.index,
    localTime: outgoingLocal,
    scale: beatScale(outgoingClip.beat, outgoingLocal),
    opacity: fadeInOpacity(outgoingClip.beat, outgoingLocal) * under * (1 - fadeOut),
    beat: outgoingClip.beat,
  };

  const incoming = incomingClip
    ? (() => {
        const local = localTimeInClip(incomingClip, t);
        return {
          clipIndex: incomingClip.index,
          localTime: local,
          scale: beatScale(incomingClip.beat, local),
          opacity: fadeInOpacity(incomingClip.beat, local) * mix * (1 - fadeOut),
          beat: incomingClip.beat,
        } satisfies PreviewLayer;
      })()
    : null;

  const overlayHit =
    overlayHitsFromClips(clips, duration).find((hit) => t >= hit.start && t <= hit.end) ?? null;

  return {
    time: t,
    duration,
    outgoing,
    incoming,
    mix,
    fadeBlack: fadeBlack * (1 - fadeOut),
    programFade: fadeOut,
    captionVisible: spec.captions.strategy === 'full' && t < FACTORY_LIMITS.captionSeconds,
    branding: brandingPreviewAt(spec.branding ?? emptyProgramBranding, t, duration),
    inOverlap,
    joinOverlay: overlayHit
      ? { name: overlayHit.name, opacity: overlayOpacityAt(overlayHit, t) }
      : null,
  };
}

export function splitSpecAtPlayhead(
  spec: ProgramPresetSpec,
  time: number,
): ProgramPresetSpec | null {
  if (spec.beats.length >= FACTORY_LIMITS.maxTakes) return null;
  const { clips } = buildProgramTimeline(spec);
  const clip = clipAtTime(clips, time);
  if (!clip) return null;
  const local = Number(localTimeInClip(clip, time).toFixed(2));
  const rest = Number((clip.duration - local).toFixed(2));
  if (local < FACTORY_LIMITS.minBeatSeconds || rest < FACTORY_LIMITS.minBeatSeconds) return null;
  const left: PlaybookBeat = { ...clip.beat, durationSeconds: local };
  const right: PlaybookBeat = {
    ...clip.beat,
    name: `${clip.beat.name}-b`.slice(0, 40),
    durationSeconds: rest,
    join: 'cut',
    fadeIn: false,
    joinDurationSeconds: undefined,
    joinOverlay: undefined,
  };
  return {
    ...spec,
    beats: [...spec.beats.slice(0, clip.index), left, right, ...spec.beats.slice(clip.index + 1)],
  };
}

export function canSplitAt(spec: ProgramPresetSpec, time: number) {
  return splitSpecAtPlayhead(spec, time) !== null;
}

export function duplicateBeatAt(spec: ProgramPresetSpec, index: number): ProgramPresetSpec | null {
  const beat = spec.beats[index];
  if (!beat || spec.beats.length >= FACTORY_LIMITS.maxTakes) return null;
  const copy: PlaybookBeat = { ...beat, name: `${beat.name}-copy`.slice(0, 40), join: 'cut' };
  return {
    ...spec,
    beats: [...spec.beats.slice(0, index + 1), copy, ...spec.beats.slice(index + 1)],
  };
}

export function moveBeat(
  spec: ProgramPresetSpec,
  index: number,
  direction: -1 | 1,
): ProgramPresetSpec {
  const next = index + direction;
  if (next < 0 || next >= spec.beats.length) return spec;
  const beats = [...spec.beats];
  const [removed] = beats.splice(index, 1);
  beats.splice(next, 0, removed!);
  return { ...spec, beats };
}

export function emptyBeat(index: number): PlaybookBeat {
  return {
    name: `take-${index + 1}`,
    roles: ['master'],
    durationSeconds: 1.9,
    reason: 'Take',
    join: 'cut',
    motion: 'none',
    preferPeak: true,
  };
}

export function programCapacity(spec: ProgramPresetSpec) {
  const { clips, duration } = buildProgramTimeline(spec);
  const nominal = spec.beats.reduce((sum, beat) => sum + beat.durationSeconds, 0);
  const overlapSaved = Number((nominal - duration).toFixed(3));
  const total = nominal || 1;
  const roles = new Set(spec.beats.flatMap((beat) => beat.roles));
  const food =
    spec.beats
      .filter((beat) => beat.roles.includes('food'))
      .reduce((sum, beat) => sum + beat.durationSeconds, 0) / total;
  const kitchen =
    spec.beats
      .filter((beat) => beat.roles.includes('side'))
      .reduce((sum, beat) => sum + beat.durationSeconds, 0) / total;
  const adjacentSame = spec.beats.some(
    (beat, index) =>
      index > 0 && beat.roles[0] && beat.roles[0] === spec.beats[index - 1]?.roles[0],
  );
  const kenBurns = spec.beats.filter(
    (beat) => beat.motion === 'punch' || beat.motion === 'drift',
  ).length;
  const warnings: string[] = [];
  if (spec.beats.length < FACTORY_LIMITS.minTakes)
    warnings.push(`Mínimo de ${FACTORY_LIMITS.minTakes} takes para o FFmpeg montar o programa`);
  if (spec.beats.length > FACTORY_LIMITS.maxTakes)
    warnings.push('FFmpeg desta fábrica para em 12 takes');
  if (duration > spec.targetDuration + 1.5)
    warnings.push(`Programa ${duration.toFixed(1)}s acima do alvo ${spec.targetDuration}s`);
  if (duration < spec.targetDuration - 3)
    warnings.push(`Programa ${duration.toFixed(1)}s abaixo do alvo ${spec.targetDuration}s`);
  if (roles.size < spec.minRoles)
    warnings.push(`Usa ${roles.size} papéis; o mínimo deste programa é ${spec.minRoles}`);
  if (spec.program === 'casa' && food > 0.28)
    warnings.push('Casa não pode viver de prato — comida acima de 28%');
  if (
    spec.program === 'assinatura' &&
    (spec.beats[0]?.roles[0] === 'food' || spec.beats.at(-1)?.roles[0] === 'food')
  ) {
    warnings.push('Assinatura não abre nem fecha no ISO de comida');
  }
  if (spec.program === 'pulso' && adjacentSame)
    warnings.push('Pulso não deve repetir o mesmo papel em takes vizinhos');
  if (kenBurns >= 6)
    warnings.push('Muitos Ken Burns no perfil HIGH — esta máquina rende 1 FFmpeg de cada vez');
  return {
    takeCount: spec.beats.length,
    duration,
    nominal,
    overlapSaved,
    target: spec.targetDuration,
    roles: [...roles],
    foodShare: food,
    kitchenShare: kitchen,
    adjacentSame,
    kenBurns,
    warnings,
    clips,
  };
}

export function formatTimecode(seconds: number) {
  const safe = Math.max(0, seconds);
  const totalCs = Math.round(safe * 100);
  const m = Math.floor(totalCs / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function clampBeatDuration(seconds: number) {
  const value = Number.isFinite(seconds) ? seconds : FACTORY_LIMITS.minBeatSeconds;
  return Number(
    Math.min(FACTORY_LIMITS.maxBeatSeconds, Math.max(FACTORY_LIMITS.minBeatSeconds, value)).toFixed(
      2,
    ),
  );
}

export function snapTime(spec: ProgramPresetSpec, time: number, threshold = 0.1) {
  const { clips, duration } = buildProgramTimeline(spec);
  const points = [0, duration];
  for (const clip of clips) {
    points.push(clip.start, clip.end);
  }
  let best = Math.max(0, Math.min(duration, time));
  let dist = threshold;
  for (const point of points) {
    const delta = Math.abs(point - time);
    if (delta < dist) {
      best = point;
      dist = delta;
    }
  }
  return best;
}

export function specsEqual(a: ProgramPresetSpec, b: ProgramPresetSpec) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type ProgramSpecDiffLine = {
  kind: 'takes' | 'duration' | 'join' | 'captions' | 'branding' | 'target' | 'beat';
  label: string;
};

export function diffProgramSpecs(
  from: ProgramPresetSpec,
  to: ProgramPresetSpec,
): ProgramSpecDiffLine[] {
  const fromCap = programCapacity(from);
  const toCap = programCapacity(to);
  const lines: ProgramSpecDiffLine[] = [];
  if (fromCap.takeCount !== toCap.takeCount) {
    lines.push({ kind: 'takes', label: `Takes ${fromCap.takeCount} → ${toCap.takeCount}` });
  }
  if (Math.abs(fromCap.duration - toCap.duration) > 0.05) {
    lines.push({
      kind: 'duration',
      label: `Duração ${fromCap.duration.toFixed(1)}s → ${toCap.duration.toFixed(1)}s`,
    });
  }
  if (from.targetDuration !== to.targetDuration) {
    lines.push({ kind: 'target', label: `Alvo ${from.targetDuration}s → ${to.targetDuration}s` });
  }
  if (from.join !== to.join) {
    lines.push({
      kind: 'join',
      label: `Join padrão ${joinLabels[from.join]} → ${joinLabels[to.join]}`,
    });
  }
  if (from.captions.strategy !== to.captions.strategy) {
    lines.push({
      kind: 'captions',
      label:
        to.captions.strategy === 'full'
          ? 'Legendas desligadas → ligadas'
          : 'Legendas ligadas → desligadas',
    });
  }
  (Object.keys(brandingLayerLabels) as (keyof ProgramBranding)[]).forEach((key) => {
    const previous = (from.branding ?? emptyProgramBranding)[key];
    const next = (to.branding ?? emptyProgramBranding)[key];
    if (previous === next) return;
    lines.push({
      kind: 'branding',
      label: next
        ? `${brandingLayerLabels[key]} desligado → ligado`
        : `${brandingLayerLabels[key]} ligado → desligado`,
    });
  });
  const max = Math.max(from.beats.length, to.beats.length);
  for (let index = 0; index < max; index += 1) {
    const previous = from.beats[index];
    const next = to.beats[index];
    if (!previous && next) {
      lines.push({
        kind: 'beat',
        label: `Take ${index + 1}: ${next.name} adicionado (${next.durationSeconds.toFixed(1)}s)`,
      });
      continue;
    }
    if (previous && !next) {
      lines.push({ kind: 'beat', label: `Take ${index + 1}: ${previous.name} removido` });
      continue;
    }
    if (!previous || !next) continue;
    const changes: string[] = [];
    if (previous.name !== next.name) changes.push(`${previous.name} → ${next.name}`);
    if (Math.abs(previous.durationSeconds - next.durationSeconds) > 0.04) {
      changes.push(`${previous.durationSeconds.toFixed(1)}s → ${next.durationSeconds.toFixed(1)}s`);
    }
    if (previous.join !== next.join)
      changes.push(`${joinLabels[previous.join]} → ${joinLabels[next.join]}`);
    const previousOverlay = previous.joinOverlay ?? 'none';
    const nextOverlay = next.joinOverlay ?? 'none';
    if (previousOverlay !== nextOverlay) {
      changes.push(`${joinOverlayLabels[previousOverlay]} → ${joinOverlayLabels[nextOverlay]}`);
    }
    const previousMotion = previous.motion ?? 'none';
    const nextMotion = next.motion ?? 'none';
    if (previousMotion !== nextMotion) {
      changes.push(`${motionLabels[previousMotion]} → ${motionLabels[nextMotion]}`);
    }
    if (Boolean(previous.punchIn) !== Boolean(next.punchIn))
      changes.push(next.punchIn ? 'punch-in ligado' : 'punch-in desligado');
    if (Boolean(previous.fadeIn) !== Boolean(next.fadeIn))
      changes.push(next.fadeIn ? 'fade in ligado' : 'fade in desligado');
    if (Boolean(previous.fadeOut) !== Boolean(next.fadeOut))
      changes.push(next.fadeOut ? 'fade out ligado' : 'fade out desligado');
    if (changes.length)
      lines.push({ kind: 'beat', label: `Take ${index + 1}: ${changes.join(' · ')}` });
  }
  return lines;
}
