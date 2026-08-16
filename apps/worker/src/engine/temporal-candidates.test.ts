import { describe, expect, it } from 'vitest';
import { distinctClusterHubs } from './peak-snap.js';
import {
  pairAssembly,
  pairCompatibility,
  temporalCandidatesFromPeaks,
} from './temporal-candidates.js';

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

  it('keeps a far dining-room spike as a second hub instead of hiding the stage', () => {
    const hubs = distinctClusterHubs({
      windowStart: 0,
      windowDuration: 240,
      takeDuration: 12,
      peaks: [
        { offsetSeconds: 18, fusedScore: 70 },
        { offsetSeconds: 22, fusedScore: 68 },
        { offsetSeconds: 210, fusedScore: 99 },
      ],
    });
    expect(hubs.some((hub) => hub < 50)).toBe(true);
    expect(hubs.some((hub) => hub > 150)).toBe(true);
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

  it('allows one act cut and rejects a loop or a second far jump', () => {
    const hook = {
      cameraId: 'cam-1',
      start: 600,
      end: 608,
      peak: 600,
      fusedScore: 90,
      usable: true,
    };
    const loop = { ...hook, start: 605.4, end: 613.4, peak: 605 };
    const act = { ...hook, start: 788, end: 796, peak: 792 };
    const again = { ...hook, start: 900, end: 908, peak: 900 };
    expect(pairAssembly(hook, loop).ok).toBe(false);
    expect(pairAssembly(hook, act).ok).toBe(true);
    expect(pairAssembly(hook, act).reason).toBe('act_cut');
    expect(pairAssembly(act, again, 1).ok).toBe(false);
  });
});
