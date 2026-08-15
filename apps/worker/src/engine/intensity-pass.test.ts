import { describe, expect, it } from 'vitest';
import { resolveEditingIntensityProfile } from '@reelops/shared';
import { applyEditingIntensity } from './intensity-pass.js';
import type { ReelPlan, ReelPlanScene } from './planner.js';

function scene(
  partial: Partial<ReelPlanScene> & Pick<ReelPlanScene, 'camera_id' | 'transition'>,
): ReelPlanScene {
  return {
    source_recording_path: `${partial.camera_id}.mp4`,
    source_start_offset: 2,
    duration: 2.4,
    speed: 1,
    reason: 'test',
    position: 1,
    hasAudio: true,
    role: 'master',
    ...partial,
  };
}

function plan(program: ReelPlan['program'], scenes: ReelPlanScene[]): ReelPlan {
  return {
    program,
    join: program === 'pulso' ? 'cut' : 'dissolve',
    duration: scenes.reduce((sum, item) => sum + item.duration, 0),
    aspect_ratio: '9:16',
    scenes,
    score: 70,
    detailedScores: { food: 70, action: 70, visual: 70, marketing: 50, ambience: 40 },
    reason: 'test',
    provider: 'heuristic',
  };
}

describe('editing intensity pass', () => {
  it('keeps Casa dissolves and does not invent a punch-in', () => {
    const original = plan('casa', [
      scene({ camera_id: 'c1', transition: 'cut', motion: 'none' }),
      scene({ camera_id: 'c2', transition: 'dissolve', joinDuration: 0.58, role: 'food' }),
      scene({
        camera_id: 'c3',
        transition: 'dissolve',
        joinDuration: 0.58,
        role: 'ambience',
        motion: 'drift',
      }),
      scene({ camera_id: 'c1', transition: 'dissolve', joinDuration: 0.58 }),
    ]);
    const next = applyEditingIntensity(original, resolveEditingIntensityProfile(0.25));
    expect(next.scenes.filter((item) => item.transition === 'dissolve')).toHaveLength(3);
    expect(next.scenes.some((item) => item.punchIn)).toBe(false);
  });

  it('flattens extra Pulso dissolves to cuts', () => {
    const original = plan('pulso', [
      scene({ camera_id: 'c1', transition: 'cut' }),
      scene({ camera_id: 'c2', transition: 'dissolve', joinDuration: 0.4 }),
      scene({ camera_id: 'c3', transition: 'dissolve', joinDuration: 0.4 }),
      scene({ camera_id: 'c4', transition: 'dissolve', joinDuration: 0.4 }),
      scene({ camera_id: 'c1', transition: 'dissolve', joinDuration: 0.4 }),
      scene({ camera_id: 'c2', transition: 'dissolve', joinDuration: 0.4 }),
    ]);
    const next = applyEditingIntensity(original, resolveEditingIntensityProfile(0.8));
    expect(next.scenes.filter((item) => item.transition === 'dissolve').length).toBeLessThan(5);
    expect(
      next.scenes.some((item) => item.transition === 'cut' && item.joinDuration === 0.04),
    ).toBe(true);
  });

  it('strips idle motion at low intensity and adds a food punch at high zoom', () => {
    const quiet = applyEditingIntensity(
      plan('casa', [
        scene({ camera_id: 'c1', transition: 'cut', motion: 'drift' }),
        scene({ camera_id: 'c2', transition: 'dissolve', role: 'food', motion: 'none' }),
        scene({ camera_id: 'c3', transition: 'dissolve', motion: 'none' }),
      ]),
      resolveEditingIntensityProfile(0.1),
    );
    expect(quiet.scenes.every((item) => item.motion === 'none' || item.punchIn)).toBe(true);

    const loud = applyEditingIntensity(
      plan('pulso', [
        scene({ camera_id: 'c1', transition: 'cut', motion: 'none' }),
        scene({ camera_id: 'c2', transition: 'cut', role: 'food', motion: 'none' }),
        scene({ camera_id: 'c3', transition: 'cut', motion: 'none' }),
      ]),
      resolveEditingIntensityProfile(0.8),
    );
    expect(loud.scenes.some((item) => item.role === 'food' && item.punchIn)).toBe(true);
  });

  it('caps camera switches on a calm Casa cutdown', () => {
    const original = plan('casa', [
      scene({ camera_id: 'c1', transition: 'cut' }),
      scene({ camera_id: 'c2', transition: 'dissolve', duration: 1.1 }),
      scene({ camera_id: 'c3', transition: 'dissolve', duration: 1.05 }),
      scene({ camera_id: 'c4', transition: 'dissolve', duration: 1.2 }),
      scene({ camera_id: 'c1', transition: 'dissolve', duration: 1.15 }),
      scene({ camera_id: 'c2', transition: 'dissolve' }),
    ]);
    const next = applyEditingIntensity(original, resolveEditingIntensityProfile(0.25));
    expect(next.scenes.length).toBeLessThan(original.scenes.length);
  });
});
