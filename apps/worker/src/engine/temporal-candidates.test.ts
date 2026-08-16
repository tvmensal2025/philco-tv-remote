import { describe, expect, it } from 'vitest';
import { pairCompatibility, temporalCandidatesFromPeaks } from './temporal-candidates.js';

describe('temporal candidates', () => {
  it('keeps candidate windows on the live peak instead of the far dining-room offset', () => {
    const rows = temporalCandidatesFromPeaks({
      cameraId: 'cam-1',
      windowStart: 0,
      windowDuration: 240,
      takeDuration: 12,
      peaks: [
        { offsetSeconds: 18, fusedScore: 92 },
        { offsetSeconds: 22, fusedScore: 80 },
        { offsetSeconds: 210, fusedScore: 99 },
      ],
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.end - row.start >= 1.6)).toBe(true);
    expect(Math.max(...rows.map((row) => row.start))).toBeLessThan(70);
    expect(rows.some((row) => row.peak === 210)).toBe(false);
  });

  it('marks a far jump as incompatible on the same camera', () => {
    const near = {
      cameraId: 'cam-1',
      start: 12,
      end: 24,
      peak: 18,
      fusedScore: 90,
      usable: true,
    };
    const far = { ...near, start: 200, end: 212, peak: 210 };
    expect(pairCompatibility(near, { ...near, start: 20, end: 32, peak: 22 }).ok).toBe(true);
    expect(pairCompatibility(near, far).ok).toBe(false);
  });
});
