import { CASA_CLUSTER_SPAN_SECONDS, clusterHub, type PeakHit } from './peak-snap.js';

export type TemporalCandidate = {
  cameraId: string;
  start: number;
  end: number;
  peak: number;
  fusedScore: number;
  usable: boolean;
};

/** FFmpeg peaks already found scene changes. Turn them into clip windows on the live stage. */
export function temporalCandidatesFromPeaks(input: {
  cameraId: string;
  windowStart: number;
  windowDuration: number;
  peaks: PeakHit[];
  takeDuration: number;
  hub?: number;
}): TemporalCandidate[] {
  const hub =
    input.hub ??
    clusterHub({
      windowStart: input.windowStart,
      windowDuration: input.windowDuration,
      takeDuration: input.takeDuration,
      peaks: input.peaks,
    });
  const radius = CASA_CLUSTER_SPAN_SECONDS / 2;
  const take = Math.max(2.4, Math.min(14, input.takeDuration));
  return [...input.peaks]
    .filter((peak) => Math.abs(peak.offsetSeconds - hub) <= radius)
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, 10)
    .map((peak) => {
      const start = Number(
        Math.max(input.windowStart, peak.offsetSeconds - take * 0.35).toFixed(3),
      );
      const end = Number(
        Math.min(input.windowStart + input.windowDuration, start + take).toFixed(3),
      );
      return {
        cameraId: input.cameraId,
        start,
        end,
        peak: peak.offsetSeconds,
        fusedScore: peak.fusedScore,
        usable: end - start >= 1.6,
      };
    })
    .filter((row) => row.usable);
}

export function pairCompatibility(left: TemporalCandidate, right: TemporalCandidate) {
  if (left.cameraId !== right.cameraId) {
    return { ok: true, score: 72, reason: 'camera_cut' };
  }
  const gap = Math.abs(right.start - left.start);
  if (gap <= CASA_CLUSTER_SPAN_SECONDS) {
    return { ok: true, score: 90, reason: 'same_stage' };
  }
  return { ok: false, score: 28, reason: 'far_jump' };
}
