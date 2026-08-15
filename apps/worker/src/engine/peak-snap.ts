export type PeakHit = { offsetSeconds: number; fusedScore: number };

export const HIGH_QUALITY_CAMERA_SCORE = 70;

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

export function snapTake(input: {
  windowStart: number;
  windowDuration: number;
  takeDuration: number;
  peaks: PeakHit[];
  usedOffsets?: number[];
  preferredStart?: number;
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
  const minGap = Math.max(1.5, takeDuration * 0.45);
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
