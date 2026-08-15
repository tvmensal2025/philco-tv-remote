import { describe, expect, it } from 'vitest';
import {
  pickAiReelDuration,
  resolveMomentSearchWindow,
  searchPoolForDuration,
  snapReelDuration,
  takeCountForDuration,
} from './reel-duration.js';

describe('reel duration', () => {
  it('snaps arbitrary lengths onto 15/30/45/60', () => {
    expect(snapReelDuration(12)).toBe(15);
    expect(snapReelDuration(28)).toBe(30);
    expect(snapReelDuration(50)).toBe(45);
    expect(snapReelDuration(88)).toBe(60);
  });

  it('keeps the search pool at least as long as the reel', () => {
    const pool = searchPoolForDuration(60);
    expect(pool.beforeSeconds + pool.afterSeconds).toBeGreaterThanOrEqual(60);
    const window = resolveMomentSearchWindow({
      durationSeconds: 30,
      beforeSeconds: 5,
      afterSeconds: 5,
    });
    expect(window.beforeSeconds + window.afterSeconds).toBeGreaterThanOrEqual(30);
  });

  it('picks a shorter preset when the pool or peaks are weak', () => {
    expect(pickAiReelDuration({ poolSeconds: 18, peakCount: 1, visionScore: 30 })).toBe(15);
    expect(pickAiReelDuration({ poolSeconds: 80, peakCount: 8, visionScore: 80 })).toBe(60);
    expect(pickAiReelDuration({ poolSeconds: 50, peakCount: 4, visionScore: 70 })).toBe(45);
  });

  it('uses fewer takes on a 15s Casa than on 60s Pulso', () => {
    expect(takeCountForDuration('casa', 15)).toBeLessThan(takeCountForDuration('pulso', 60));
  });
});
