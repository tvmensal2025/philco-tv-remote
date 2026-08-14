export type CoverageClip = {
  cameraId: string;
  startedAt: string;
  endedAt: string;
};

export type LatestCoverage = {
  occurredAt: string;
  beforeSeconds: number;
  afterSeconds: number;
  cameraCount: number;
  windowStart: string;
  windowEnd: string;
};

function clampWindow(seconds: number) {
  return Math.max(3, Math.min(120, seconds));
}

export function pickLatestCoverage(clips: CoverageClip[]): LatestCoverage | null {
  const rows = clips
    .map((clip) => ({
      cameraId: clip.cameraId,
      start: Date.parse(clip.startedAt),
      end: Date.parse(clip.endedAt),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.start) && Number.isFinite(row.end) && row.end - row.start >= 8_000,
    );
  if (!rows.length) return null;

  let best: { cameras: number; overlapStart: number; overlapEnd: number } | null = null;
  for (const seed of rows) {
    const overlapping = rows.filter((row) => row.start < seed.end && row.end > seed.start);
    const cameras = new Set(overlapping.map((row) => row.cameraId));
    const overlapStart = Math.max(...overlapping.map((row) => row.start));
    const overlapEnd = Math.min(...overlapping.map((row) => row.end));
    if (overlapEnd - overlapStart < 8_000) continue;
    const better =
      !best ||
      cameras.size > best.cameras ||
      (cameras.size === best.cameras && overlapEnd > best.overlapEnd);
    if (better) best = { cameras: cameras.size, overlapStart, overlapEnd };
  }
  if (!best) return null;

  const duration = best.overlapEnd - best.overlapStart;
  const occurredAt = best.overlapStart + Math.floor(duration / 2);
  const beforeSeconds = clampWindow(Math.floor((occurredAt - best.overlapStart) / 1000) - 1);
  const afterSeconds = clampWindow(Math.floor((best.overlapEnd - occurredAt) / 1000) - 1);
  return {
    occurredAt: new Date(occurredAt).toISOString(),
    beforeSeconds,
    afterSeconds,
    cameraCount: best.cameras,
    windowStart: new Date(occurredAt - beforeSeconds * 1000).toISOString(),
    windowEnd: new Date(occurredAt + afterSeconds * 1000).toISOString(),
  };
}
