import { describe, expect, it } from 'vitest';
import {
  defaultEditingIntensityForProgram,
  resolveEditingIntensityProfile,
} from './edit-intensity.js';

describe('resolveEditingIntensityProfile', () => {
  it('keeps fine dining slower than pulso', () => {
    const fine = resolveEditingIntensityProfile(0.25);
    const pulso = resolveEditingIntensityProfile(defaultEditingIntensityForProgram('pulso'));
    expect(fine.targetShotDurationMs).toBeGreaterThan(pulso.targetShotDurationMs);
    expect(pulso.maxZoomStrength).toBeGreaterThan(fine.maxZoomStrength);
    expect(pulso.maxCameraSwitchesPer10s).toBeGreaterThan(fine.maxCameraSwitchesPer10s);
  });

  it('clamps out of range values', () => {
    expect(resolveEditingIntensityProfile(-2).targetShotDurationMs).toBe(
      resolveEditingIntensityProfile(0).targetShotDurationMs,
    );
    expect(resolveEditingIntensityProfile(9).maxZoomStrength).toBe(
      resolveEditingIntensityProfile(1).maxZoomStrength,
    );
  });
});
