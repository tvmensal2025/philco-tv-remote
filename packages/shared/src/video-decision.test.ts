import { describe, expect, it } from 'vitest';
import { parseVideoEditDecision, repairVideoEditDecision } from './video-decision.js';
import { adaptVideoEditDecisionV1ToV2, parseVideoEditDecisionV2 } from './video-decision-v2.js';

const valid = {
  schemaVersion: '1.0',
  tenantId: '11111111-1111-1111-1111-111111111111',
  restaurantId: '22222222-2222-2222-2222-222222222222',
  program: 'casa',
  confidence: 90,
  scoreScale: '0-100',
  durationTargetMs: 20000,
  story: { type: 'experience', hookScore: 80, pace: 'medium_fast', emotion: 'warm' },
  scenes: [
    {
      cameraId: 'cam-1',
      sourceStartMs: 1000,
      sourceEndMs: 4000,
      role: 'hook',
      cropStrategy: 'center_crop',
      motion: 'slow_push',
      transitionOut: 'soft_dissolve',
      importance: 100,
    },
  ],
  audio: {
    strategy: 'original_audio',
    preserveAmbient: true,
    originalGainDb: -16,
    musicGainDb: null,
    voiceGainDb: null,
  },
  text: { enabled: false, title: null, subtitle: null, cta: null },
  captions: { strategy: 'none' },
  branding: { profileId: null, showLogo: false },
  qualityRequirements: { minimumVisualScore: 0 },
};

describe('VideoEditDecisionV1', () => {
  it('accepts a complete decision', () => {
    expect(parseVideoEditDecision(valid).success).toBe(true);
  });

  it('rejects inverted scene times and invented enums', () => {
    expect(
      parseVideoEditDecision({
        ...valid,
        scenes: [{ ...valid.scenes[0], sourceStartMs: 5000, sourceEndMs: 1000 }],
      }).success,
    ).toBe(false);
    expect(
      parseVideoEditDecision({
        ...valid,
        scenes: [
          { ...valid.scenes[0], sourceStartMs: 1_720_000_000_000, sourceEndMs: 1_720_000_008_000 },
        ],
      }).success,
    ).toBe(false);
    expect(parseVideoEditDecision({ ...valid, program: 'tiktok' }).success).toBe(false);
    expect(
      parseVideoEditDecision({ ...valid, audio: { ...valid.audio, strategy: 'whatever' } }).success,
    ).toBe(false);
  });

  it('repairs a missing schemaVersion once', () => {
    const { schemaVersion: _, ...rest } = valid;
    const repaired = repairVideoEditDecision(rest);
    expect(repaired.success).toBe(true);
  });

  it('coerces second-based timestamps from a model', () => {
    const repaired = repairVideoEditDecision({
      ...valid,
      durationTargetMs: 18,
      scenes: [{ ...valid.scenes[0], sourceStartMs: 5.2, sourceEndMs: 9.4, importance: 0.9 }],
    });
    expect(repaired.success).toBe(true);
    if (!repaired.success) return;
    expect(repaired.data.durationTargetMs).toBe(18000);
    expect(repaired.data.scenes[0]?.sourceStartMs).toBe(5200);
    expect(repaired.data.scenes[0]?.sourceEndMs).toBe(9400);
    expect(repaired.data.scenes[0]?.importance).toBe(90);
  });

  it('keeps scores on the 0-100 scale', () => {
    expect(parseVideoEditDecision({ ...valid, confidence: 0.91 }).success).toBe(false);
    expect(parseVideoEditDecision({ ...valid, confidence: 94 }).success).toBe(true);
  });
});

describe('VideoEditDecisionV2 adapter', () => {
  it('preserves V1 and maps to V2 without dropping scenes', () => {
    const v1 = parseVideoEditDecision({
      ...valid,
      tenantId: '11111111-1111-1111-1111-111111111111',
      restaurantId: '22222222-2222-2222-2222-222222222222',
      momentId: '33333333-3333-3333-3333-333333333333',
    });
    expect(v1.success).toBe(true);
    if (!v1.success) return;
    const v2 = adaptVideoEditDecisionV1ToV2(v1.data);
    expect(v2.schemaVersion).toBe('2.0');
    expect(v2.scenes).toHaveLength(1);
    expect(v2.scenes[0]?.cameraId).toBe('cam-1');
    expect(v2.editingIntensity).toBeGreaterThan(0);
    expect(parseVideoEditDecisionV2(v2).success).toBe(true);
  });
});
