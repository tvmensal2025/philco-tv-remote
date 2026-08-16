export type PeakHit = { offsetSeconds: number; fusedScore: number };

export const HIGH_QUALITY_CAMERA_SCORE = 70;
export const CASA_CLUSTER_SPAN_SECONDS = 48;

export function spreadPreferredStart(input: {
  windowStart: number;
  windowDuration: number;
  takeDuration: number;
  index: number;
  count: number;
}) {
  if (input.count <= 1) return Number(input.windowStart.toFixed(3));
  const t = input.index / (input.count - 1);
  const usable = Math.max(0, input.windowDuration - input.takeDuration);
  return Number((input.windowStart + t * usable).toFixed(3));
}

export function clusterHub(input: {
  windowStart: number;
  windowDuration: number;
  takeDuration: number;
  peaks: PeakHit[];
}) {
  const windowStart = Math.max(0, input.windowStart);
  const windowEnd = windowStart + Math.max(input.takeDuration, input.windowDuration);
  const usableEnd = Math.max(windowStart, windowEnd - input.takeDuration);
  const inWindow = [...input.peaks].filter(
    (peak) => peak.offsetSeconds >= windowStart && peak.offsetSeconds <= windowEnd,
  );
  const neighborhood = (peak: PeakHit) =>
    inWindow
      .filter(
        (other) =>
          Math.abs(other.offsetSeconds - peak.offsetSeconds) <= CASA_CLUSTER_SPAN_SECONDS / 2,
      )
      .reduce((sum, other) => sum + other.fusedScore, 0);
  const best = [...inWindow].sort(
    (left, right) => neighborhood(right) - neighborhood(left) || right.fusedScore - left.fusedScore,
  )[0];
  const fallback = windowStart + Math.min(1.2, input.windowDuration * 0.25);
  const hub = best?.offsetSeconds ?? fallback;
  return Number(Math.max(windowStart, Math.min(usableEnd, hub)).toFixed(3));
}

/** Distinct live neighborhoods across a long window — not only the busiest dining-room cluster. */
export function distinctClusterHubs(
  input: {
    windowStart: number;
    windowDuration: number;
    takeDuration: number;
    peaks: PeakHit[];
  },
  limit = 4,
): number[] {
  const windowStart = Math.max(0, input.windowStart);
  const windowEnd = windowStart + Math.max(input.takeDuration, input.windowDuration);
  const usableEnd = Math.max(windowStart, windowEnd - input.takeDuration);
  const inWindow = [...input.peaks].filter(
    (peak) => peak.offsetSeconds >= windowStart && peak.offsetSeconds <= windowEnd,
  );
  const neighborhood = (peak: PeakHit) =>
    inWindow
      .filter(
        (other) =>
          Math.abs(other.offsetSeconds - peak.offsetSeconds) <= CASA_CLUSTER_SPAN_SECONDS / 2,
      )
      .reduce((sum, other) => sum + other.fusedScore, 0);
  const ranked = [...inWindow].sort(
    (left, right) => neighborhood(right) - neighborhood(left) || right.fusedScore - left.fusedScore,
  );
  const hubs: number[] = [];
  const consider = (offset: number) => {
    const clamped = Number(Math.max(windowStart, Math.min(usableEnd, offset)).toFixed(3));
    if (hubs.some((hub) => Math.abs(hub - clamped) < CASA_CLUSTER_SPAN_SECONDS)) return;
    hubs.push(clamped);
  };
  for (const peak of ranked) {
    consider(peak.offsetSeconds);
    if (hubs.length >= limit) return hubs;
  }
  const thirds = 3;
  for (let index = 0; index < thirds; index += 1) {
    const from = windowStart + (input.windowDuration * index) / thirds;
    const to = windowStart + (input.windowDuration * (index + 1)) / thirds;
    const local = inWindow
      .filter((peak) => peak.offsetSeconds >= from && peak.offsetSeconds < to)
      .sort((left, right) => right.fusedScore - left.fusedScore)[0];
    if (local) consider(local.offsetSeconds);
    if (hubs.length >= limit) return hubs;
  }
  if (!hubs.length) consider(windowStart + Math.min(1.2, input.windowDuration * 0.25));
  return hubs;
}

/** Keep Casa takes on the same stage instead of touring a long capture window. */
export function clusterPreferredStart(input: {
  windowStart: number;
  windowDuration: number;
  takeDuration: number;
  index: number;
  count: number;
  peaks: PeakHit[];
  hub?: number;
  minGap?: number;
}) {
  const hub = input.hub ?? clusterHub(input);
  const gap = Math.max(input.minGap ?? 1.5, input.takeDuration * 0.45);
  const startSpan = Math.min(
    CASA_CLUSTER_SPAN_SECONDS,
    Math.max(input.takeDuration * 0.5, Math.max(0, input.count - 1) * gap),
  );
  const clusterStart = hub - startSpan * 0.2;
  const t = input.count <= 1 ? 0 : input.index / (input.count - 1);
  const preferred = clusterStart + t * startSpan;
  const windowStart = Math.max(0, input.windowStart);
  const usableEnd = windowStart + Math.max(0, input.windowDuration - input.takeDuration);
  return Number(Math.max(windowStart, Math.min(usableEnd, preferred)).toFixed(3));
}

function offsetOnHub(input: {
  windowStart: number;
  windowDuration: number;
  takeDuration: number;
  usedOffsets: number[];
  peaks: PeakHit[];
  hub: number;
}): number | null {
  const radius = CASA_CLUSTER_SPAN_SECONDS / 2;
  const used = input.usedOffsets;
  const nearby = [...input.peaks]
    .filter((peak) => Math.abs(peak.offsetSeconds - input.hub) <= radius)
    .filter((peak) => used.every((start) => Math.abs(peak.offsetSeconds - start) >= 1.4))
    .sort(
      (left, right) =>
        Math.abs(left.offsetSeconds - input.hub) - Math.abs(right.offsetSeconds - input.hub) ||
        right.fusedScore - left.fusedScore,
    );
  const preferred = nearby[0]?.offsetSeconds ?? input.hub;
  if (Math.abs(preferred - input.hub) > radius) return null;
  const snapped = snapTake({
    windowStart: input.windowStart,
    windowDuration: input.windowDuration,
    takeDuration: input.takeDuration,
    peaks: input.peaks,
    usedOffsets: used,
    preferredStart: preferred,
  });
  if (used.some((start) => Math.abs(snapped.start - start) < 1.4)) return null;
  if (Math.abs(snapped.start - input.hub) > CASA_CLUSTER_SPAN_SECONDS) return null;
  return snapped.start;
}

export function nextClusterOffset(input: {
  windowStart: number;
  windowDuration: number;
  takeDuration: number;
  usedOffsets: number[];
  peaks: PeakHit[];
  hub: number;
  hubs?: number[];
}): number | null {
  const used = input.usedOffsets;
  const scouted = input.hubs?.length ? input.hubs : [input.hub];
  const unusedHubs = scouted.filter((hub) => used.every((start) => Math.abs(hub - start) >= 8));
  const ordered = [...unusedHubs, input.hub, ...scouted.filter((hub) => hub !== input.hub)];
  const seen = new Set<number>();
  for (const hub of ordered) {
    if (seen.has(hub)) continue;
    seen.add(hub);
    const found = offsetOnHub({ ...input, hub, usedOffsets: used });
    if (found != null) return found;
  }
  return null;
}

export function snapTake(input: {
  windowStart: number;
  windowDuration: number;
  takeDuration: number;
  peaks: PeakHit[];
  usedOffsets?: number[];
  preferredStart?: number;
  minStartGap?: number;
}): { start: number; duration: number; peak: number | null } {
  const windowStart = Math.max(0, input.windowStart);
  const takeDuration = Math.min(
    Math.max(0.8, input.takeDuration),
    Math.max(0.8, input.windowDuration),
  );
  const windowEnd = windowStart + Math.max(takeDuration, input.windowDuration);
  const usedStarts = [...(input.usedOffsets ?? [])].sort((a, b) => a - b);
  const inWindow = input.peaks
    .filter((peak) => peak.offsetSeconds >= windowStart && peak.offsetSeconds <= windowEnd)
    .filter((peak) => usedStarts.every((start) => Math.abs(peak.offsetSeconds - start) >= 1.4))
    .sort((a, b) => b.fusedScore - a.fusedScore);
  const preferred =
    input.preferredStart != null
      ? Math.min(windowEnd - takeDuration, Math.max(windowStart, input.preferredStart))
      : null;
  const nearPreferred =
    preferred == null
      ? null
      : (inWindow
          .filter((peak) => Math.abs(peak.offsetSeconds - preferred) <= 4)
          .sort((a, b) => b.fusedScore - a.fusedScore)[0]?.offsetSeconds ?? null);
  const peak = preferred != null ? (nearPreferred ?? null) : (inWindow[0]?.offsetSeconds ?? null);
  const anchor = peak ?? preferred ?? windowStart + Math.min(1.2, input.windowDuration * 0.25);
  let start = anchor - takeDuration * 0.35;
  start = Math.max(windowStart, start);
  const minGap = Math.max(input.minStartGap ?? 1.5, takeDuration * 0.45);
  for (const previous of usedStarts) {
    if (Math.abs(start - previous) < minGap) start = previous + minGap;
  }
  if (start + takeDuration > windowEnd) start = Math.max(windowStart, windowEnd - takeDuration);
  if (start <= windowStart + 0.05 && peak != null && peak > windowStart + 0.6) {
    start = Math.max(windowStart, peak - takeDuration * 0.35);
  }
  const duration = Number(Math.min(takeDuration, Math.max(0.8, windowEnd - start)).toFixed(3));
  return { start: Number(start.toFixed(3)), duration, peak };
}
