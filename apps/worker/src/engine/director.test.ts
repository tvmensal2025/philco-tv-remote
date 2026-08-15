import { describe, expect, it } from 'vitest';
import { decisionFromReelPlan } from './director.js';
import { houseCutFromPlan, type ReelPlan } from './planner.js';

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

  it('keeps pad_blur when the plan already chose letterbox instead of a hard crop', () => {
    const withBlur = {
      ...plan,
      scenes: [
        {
          ...plan.scenes[0]!,
          crop: [0, 0, 1280, 720] as [number, number, number, number],
          cropMode: 'pad_blur' as const,
        },
      ],
    };
    const decision = decisionFromReelPlan(withBlur, {
      tenantId: '11111111-1111-1111-1111-111111111111',
      restaurantId: '22222222-2222-2222-2222-222222222222',
      momentId: '33333333-3333-3333-3333-333333333333',
      reelId: '44444444-4444-4444-4444-444444444444',
    });
    expect(decision.scenes[0]?.cropStrategy).toBe('pad_blur');
  });

  it('writes a short house_cut list from the rendered takes', () => {
    const cut = houseCutFromPlan({
      scenes: [
        {
          ...plan.scenes[0]!,
          recording_id: 'rec-1',
          cropMode: 'pad_blur',
          duration: 12.345,
        },
      ],
    });
    expect(cut).toEqual([
      {
        id: 'rec-1',
        reason: 'gancho',
        transition: 'dissolve',
        cropMode: 'pad_blur',
        camera: 'C4',
        duration: 12.35,
      },
    ]);
  });
});
