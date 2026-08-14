import { describe, expect, it } from 'vitest';
import { decisionFromReelPlan } from './director.js';
import type { ReelPlan } from './planner.js';

const plan: ReelPlan = {
  program: 'casa',
  join: 'dissolve',
  duration: 18,
  aspect_ratio: '9:16',
  scenes: [
    {
      camera_id: 'cam-1',
      source_recording_path: 'c1.mp4',
      source_start_offset: 5.2,
      duration: 4,
      speed: 1,
      transition: 'dissolve',
      reason: 'gancho',
      position: 4,
      hasAudio: false,
      role: 'ambience',
      motion: 'drift',
    },
  ],
  score: 81,
  detailedScores: { food: 70, action: 60, visual: 80, marketing: 70, ambience: 90 },
  reason: 'fixture',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  confidence: 88,
};

describe('LegacyReelPlannerAdapter', () => {
  it('converts seconds to recording-relative milliseconds and locked enums', () => {
    const decision = decisionFromReelPlan(plan, {
      tenantId: '11111111-1111-1111-1111-111111111111',
      restaurantId: '22222222-2222-2222-2222-222222222222',
      momentId: '33333333-3333-3333-3333-333333333333',
      reelId: '44444444-4444-4444-4444-444444444444',
    });
    expect(decision.schemaVersion).toBe('1.0');
    expect(decision.scenes[0]?.sourceStartMs).toBe(5200);
    expect(decision.scenes[0]?.sourceEndMs).toBe(9200);
    expect(decision.scenes[0]?.motion).toBe('slow_push');
    expect(decision.scenes[0]?.transitionOut).toBe('soft_dissolve');
    expect(decision.scenes[0]?.cropStrategy).toBe('center_crop');
    expect(decision.audio.strategy).toBe('cinematic');
  });

  it('marks subject_focus when YOLO already chose a crop window', () => {
    const withCrop = {
      ...plan,
      scenes: [
        { ...plan.scenes[0]!, crop: [690, 0, 608, 1080] as [number, number, number, number] },
      ],
    };
    const decision = decisionFromReelPlan(withCrop, {
      tenantId: '11111111-1111-1111-1111-111111111111',
      restaurantId: '22222222-2222-2222-2222-222222222222',
      momentId: '33333333-3333-3333-3333-333333333333',
      reelId: '44444444-4444-4444-4444-444444444444',
    });
    expect(decision.scenes[0]?.cropStrategy).toBe('subject_focus');
  });
});
