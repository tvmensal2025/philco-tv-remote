import { describe, expect, it } from 'vitest';
import type { ClipCandidate } from '../adapters/analyzer.js';
import { coverageReport } from './coverage.js';
import { snapTake } from './peak-snap.js';
import { compileProgram } from './planner.js';
import { playbookFor } from './playbook.js';

function clips(): ClipCandidate[] {
  return [1, 2, 3, 4].map((position) => ({
    cameraId: `cam-${position}`,
    path: `c${position}.mp4`,
    localPath: `c${position}.mp4`,
    position,
    startOffsetSeconds: 5,
    windowDurationSeconds: 20,
    hasAudio: position === 1,
    role:
      position === 2 ? 'side' : position === 3 ? 'food' : position === 4 ? 'ambience' : 'master',
  }));
}

function peaks() {
  const map = new Map();
  for (const position of [1, 2, 3, 4]) {
    map.set(`cam-${position}`, [
      { offsetSeconds: 7 + position, fusedScore: 80 - position },
      { offsetSeconds: 12 + position * 0.4, fusedScore: 60 },
    ]);
  }
  return map;
}

describe('four-program editor', () => {
  it('snaps IN before the peak inside the window', () => {
    const take = snapTake({
      windowStart: 5,
      windowDuration: 20,
      takeDuration: 4,
      peaks: [{ offsetSeconds: 12, fusedScore: 90 }],
    });
    expect(take.start).toBeGreaterThanOrEqual(5);
    expect(take.start).toBeLessThan(12);
    expect(take.start + take.duration).toBeLessThanOrEqual(25.01);
  });

  it('staggers a second take so the same kitchen shot is not looped', () => {
    const first = snapTake({
      windowStart: 18,
      windowDuration: 20,
      takeDuration: 5,
      peaks: [],
    });
    const second = snapTake({
      windowStart: 18,
      windowDuration: 20,
      takeDuration: 5,
      peaks: [],
      usedOffsets: [first.start],
    });
    expect(Math.abs(second.start - first.start)).toBeGreaterThanOrEqual(1.5);
  });

  it('compiles Casa around ambience, not food', () => {
    const plan = compileProgram({ clips: clips(), program: 'casa', peaksByCamera: peaks() });
    expect(plan.scenes[0]?.role).toBe('ambience');
    expect(plan.join).toBe('dissolve');
    const food = plan.scenes
      .filter((scene) => scene.role === 'food')
      .reduce((sum, scene) => sum + scene.duration, 0);
    expect(food / plan.scenes.reduce((sum, scene) => sum + scene.duration, 0)).toBeLessThan(0.28);
  });

  it('compiles Oficio with kitchen majority and hard cuts', () => {
    const plan = compileProgram({ clips: clips(), program: 'oficio', peaksByCamera: peaks() });
    expect(plan.join).toBe('cut');
    const kitchen = plan.scenes
      .filter((scene) => scene.role === 'side')
      .reduce((sum, scene) => sum + scene.duration, 0);
    expect(
      kitchen / plan.scenes.reduce((sum, scene) => sum + scene.duration, 0),
    ).toBeGreaterThanOrEqual(0.35);
  });

  it('keeps Assinatura from opening or closing on the food ISO', () => {
    const plan = compileProgram({ clips: clips(), program: 'assinatura', peaksByCamera: peaks() });
    expect(plan.scenes[0]?.role).not.toBe('food');
    expect(plan.scenes.at(-1)?.role).not.toBe('food');
    expect(plan.scenes.some((scene) => scene.punchIn && scene.role === 'food')).toBe(true);
  });

  it('cuts Pulso across at least three roles without repeating ISO', () => {
    const plan = compileProgram({ clips: clips(), program: 'pulso', peaksByCamera: peaks() });
    expect(plan.scenes.length).toBeGreaterThanOrEqual(6);
    expect(new Set(plan.scenes.map((scene) => scene.role)).size).toBeGreaterThanOrEqual(3);
    expect(
      plan.scenes.some(
        (scene, index) => index > 0 && scene.camera_id === plan.scenes[index - 1]?.camera_id,
      ),
    ).toBe(false);
  });

  it('skips Casa when the room camera is missing', () => {
    expect(() =>
      compileProgram({
        clips: clips().filter((clip) => clip.role !== 'ambience'),
        program: 'casa',
        peaksByCamera: peaks(),
      }),
    ).toThrow(/SKIP_PROGRAM:MISSING_ROLE:ambience/);
  });

  it('rejects a food-only Assinatura cut', () => {
    const report = coverageReport(playbookFor('assinatura'), [
      { role: 'food', duration: 6, cameraId: 'c3' },
      { role: 'food', duration: 6, cameraId: 'c3' },
      { role: 'food', duration: 6, cameraId: 'c3' },
    ]);
    expect(report.ok).toBe(false);
  });

  it('applies a published Pulso override without changing the validated default', () => {
    const override = playbookFor('pulso');
    override.beats = override.beats.map((beat) => ({
      ...beat,
      durationSeconds: 1.2,
      joinDurationSeconds: 0.08,
    }));
    const plan = compileProgram({
      clips: clips(),
      program: 'pulso',
      peaksByCamera: peaks(),
      playbook: override,
    });
    expect(plan.scenes[0]?.duration).toBeLessThan(1.5);
    expect(playbookFor('pulso').beats[0]?.durationSeconds).toBe(1.9);
  });
});
