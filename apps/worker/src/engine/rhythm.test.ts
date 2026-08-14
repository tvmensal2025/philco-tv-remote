import { fillToDuration, styleRhythm } from './rhythm.js';
import { describe, expect, it } from 'vitest';

describe('style rhythm', () => {
  it('keeps dynamic cuts short and cinematic cuts long', () => {
    expect(styleRhythm('dynamic').max).toBeLessThanOrEqual(styleRhythm('natural').min);
    expect(styleRhythm('cinematic').min).toBeGreaterThanOrEqual(styleRhythm('natural').max);
  });

  it('repeats camera beats until the target window is filled', () => {
    const filled = fillToDuration([{ durationSeconds: 8 }, { durationSeconds: 8 }], 12, 'dynamic');
    const total = filled.reduce((sum, scene) => sum + scene.durationSeconds, 0);
    expect(total).toBeCloseTo(12, 1);
    expect(filled.length).toBeGreaterThan(2);
    expect(filled.every((scene) => scene.durationSeconds <= 2.5)).toBe(true);
  });
});
