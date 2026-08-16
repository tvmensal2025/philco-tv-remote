import { CASA_CLUSTER_SPAN_SECONDS, clusterHub, type PeakHit } from './peak-snap.js';
import { EDITORIAL } from './editorial-thresholds.js';

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
  const kind = pairKind(left, right);
  if (kind === 'camera_cut') return { ok: true, score: 72, reason: 'camera_cut' };
  if (kind === 'same_stage') return { ok: true, score: 90, reason: 'same_stage' };
  if (kind === 'loop') return { ok: false, score: 15, reason: 'loop' };
  return { ok: false, score: 28, reason: 'far_jump' };
}

export function pairKind(left: TemporalCandidate, right: TemporalCandidate) {
  if (left.cameraId !== right.cameraId) return 'camera_cut' as const;
  const gap = Math.abs(right.start - left.start);
  if (gap < EDITORIAL.minTakeGapSeconds) return 'loop' as const;
  if (gap <= CASA_CLUSTER_SPAN_SECONDS) return 'same_stage' as const;
  return 'act_cut' as const;
}

export function pairAssembly(left: TemporalCandidate, right: TemporalCandidate, farJumpsUsed = 0) {
  const kind = pairKind(left, right);
  if (kind === 'loop') return { ok: false, score: 15, reason: 'loop' };
  if (kind === 'act_cut' && farJumpsUsed >= EDITORIAL.maxFarJumps) {
    return { ok: false, score: 28, reason: 'far_jump' };
  }
  if (kind === 'act_cut') return { ok: true, score: 60, reason: 'act_cut' };
  if (kind === 'camera_cut') return { ok: true, score: 72, reason: 'camera_cut' };
  return { ok: true, score: 90, reason: 'same_stage' };
}
