import { describe, expect, it } from 'vitest';
import { analyzePcm, syntheticClickTrack } from '@reelops/shared';
import { applyBeatEditing } from './beat-edit.js';
import type { ReelPlan } from './planner.js';

function plan(): ReelPlan {
  return {
    program: 'pulso',
    join: 'cut',
    duration: 8,
    aspect_ratio: '9:16',
    scenes: [
      {
        camera_id: 'c1',
        source_recording_path: 'a.mp4',
        source_start_offset: 2,
        duration: 2.2,
        speed: 1,
        transition: 'cut',
        reason: 'hook',
        position: 1,
        hasAudio: true,
        role: 'master',
      },
      {
        camera_id: 'c2',
        source_recording_path: 'b.mp4',
        source_start_offset: 4,
        duration: 2.15,
        speed: 1,
        transition: 'cut',
        reason: 'body',
        position: 2,
        hasAudio: false,
        role: 'side',
      },
      {
        camera_id: 'c3',
        source_recording_path: 'c.mp4',
        source_start_offset: 1,
        duration: 2.1,
        speed: 1,
        transition: 'cut',
        reason: 'payoff',
        position: 3,
        hasAudio: false,
        role: 'food',
      },
      {
        camera_id: 'c1',
        source_recording_path: 'a.mp4',
        source_start_offset: 8,
        duration: 2.05,
        speed: 1,
        transition: 'cut',
        reason: 'end',
        position: 1,
        hasAudio: true,
        role: 'master',
      },
    ],
    score: 70,
    detailedScores: { food: 70, action: 70, visual: 70, marketing: 50, ambience: 40 },
    reason: 'test',
    provider: 'heuristic',
  };
}

describe('beat editing', () => {
  it('moves pulso cuts onto the 120 BPM grid', () => {
    const analysis = analyzePcm(syntheticClickTrack({ bpm: 120, durationSeconds: 12 }));
    const next = applyBeatEditing({
      plan: plan(),
      analysis,
      snapStrength: 0.88,
      sfxDensity: 0.5,
      windowByCamera: new Map([
        ['c1', { start: 0, duration: 20 }],
        ['c2', { start: 0, duration: 20 }],
        ['c3', { start: 0, duration: 20 }],
      ]),
      targetDuration: 8,
    });
    expect(next.analysis.bpm).toBeGreaterThan(116);
    expect(next.snappedCuts).toBeGreaterThan(0);
    const firstJoin = next.plan.scenes[0]!.duration;
    const remainder = firstJoin % 0.5;
    expect(Math.min(remainder, 0.5 - remainder)).toBeLessThan(0.12);
  });

  it('barely moves casa when snap strength is low', () => {
    const analysis = analyzePcm(syntheticClickTrack({ bpm: 120, durationSeconds: 12 }));
    const original = plan();
    original.program = 'casa';
    original.scenes[1]!.transition = 'dissolve';
    original.scenes[1]!.joinDuration = 0.58;
    const next = applyBeatEditing({
      plan: original,
      analysis,
      snapStrength: 0.08,
      sfxDensity: 0.04,
      windowByCamera: new Map([
        ['c1', { start: 0, duration: 20 }],
        ['c2', { start: 0, duration: 20 }],
        ['c3', { start: 0, duration: 20 }],
      ]),
      targetDuration: 8,
    });
    expect(next.plan.scenes[1]?.joinOverlay).toBeUndefined();
    const drift = next.plan.scenes.reduce(
      (sum, scene, index) => sum + Math.abs(scene.duration - original.scenes[index]!.duration),
      0,
    );
    expect(drift).toBeLessThan(0.6);
  });

  it('offsets the music bed to a drop in the first 8s', () => {
    const analysis = analyzePcm(syntheticClickTrack({ bpm: 120, durationSeconds: 12 }));
    analysis.sections = [
      { startSeconds: 0, endSeconds: 2, kind: 'intro', energy: 0.2 },
      { startSeconds: 2, endSeconds: 10, kind: 'drop', energy: 0.9 },
    ];
    const next = applyBeatEditing({
      plan: plan(),
      analysis,
      snapStrength: 0.88,
      sfxDensity: 0.5,
      windowByCamera: new Map([
        ['c1', { start: 0, duration: 20 }],
        ['c2', { start: 0, duration: 20 }],
        ['c3', { start: 0, duration: 20 }],
      ]),
      targetDuration: 8,
    });
    expect(next.musicStartSeconds).toBeGreaterThan(1.7);
    expect(next.musicStartSeconds).toBeLessThan(2.2);
  });

  it('leaves a weak analysis untouched', () => {
    const original = plan();
    const next = applyBeatEditing({
      plan: original,
      analysis: {
        durationSeconds: 8,
        sampleRate: 22050,
        bpm: 120,
        beatPeriodSeconds: 0.5,
        timeSignature: 4,
        offsetSeconds: 0,
        confidence: 0.02,
        beats: [],
        downbeats: [],
        onsets: [],
        energyCurve: [],
        sections: [],
      },
      snapStrength: 0.9,
      sfxDensity: 0.7,
      windowByCamera: new Map(),
      targetDuration: 8,
    });
    expect(next.snappedCuts).toBe(0);
    expect(next.plan.scenes[0]?.duration).toBe(original.scenes[0]?.duration);
  });
});
