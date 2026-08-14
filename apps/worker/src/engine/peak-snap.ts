export type PeakHit = { offsetSeconds: number; fusedScore: number };

export function snapTake(input: {
  windowStart: number;
  windowDuration: number;
  takeDuration: number;
  peaks: PeakHit[];
  usedOffsets?: number[];
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
  const peak = inWindow[0]?.offsetSeconds ?? null;
  const anchor = peak ?? windowStart + Math.min(1.2, input.windowDuration * 0.25);
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
