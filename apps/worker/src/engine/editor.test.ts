import { describe, expect, it } from 'vitest';
import type { ClipCandidate } from '../adapters/analyzer.js';
import { coverageReport } from './coverage.js';
import { snapTake, spreadPreferredStart } from './peak-snap.js';
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

  it('anchors a preferred start across the window when there are no peaks', () => {
    const late = snapTake({
      windowStart: 5,
      windowDuration: 38,
      takeDuration: 5.4,
      peaks: [],
      preferredStart: spreadPreferredStart({
        windowStart: 5,
        windowDuration: 38,
        takeDuration: 5.4,
        index: 4,
        count: 5,
      }),
    });
    expect(late.start).toBeGreaterThan(20);
  });

  it('lets Casa open on food when it is the strongest listed camera', () => {
    const plan = compileProgram({ clips: clips(), program: 'casa', peaksByCamera: peaks() });
    expect(['food', 'master', 'ambience', 'side']).toContain(plan.scenes[0]?.role);
    expect(plan.join).toBe('dissolve');
    const food = plan.scenes
      .filter((scene) => scene.role === 'food')
      .reduce((sum, scene) => sum + scene.duration, 0);
    expect(food / plan.scenes.reduce((sum, scene) => sum + scene.duration, 0)).toBeLessThan(0.72);
  });

  it('lets a well-lit master beat a weak food camera on the Casa hook', () => {
    const plan = compileProgram({
      clips: clips(),
      program: 'casa',
      peaksByCamera: peaks(),
      cameraScores: new Map([
        [1, 88],
        [3, 31],
        [4, 70],
      ]),
    });
    expect(plan.scenes[0]?.role).toBe('master');
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

  it('lets Casa stay on one camera when scores say the others would hurt the reel', () => {
    const plan = compileProgram({
      clips: clips(),
      program: 'casa',
      peaksByCamera: peaks(),
      cameraScores: new Map([
        [1, 88],
        [2, 12],
        [3, 28],
        [4, 18],
      ]),
      editMode: 'single_camera',
      compatiblePositions: new Set([1]),
    });
    expect(plan.scenes.every((scene) => scene.position === 1)).toBe(true);
    expect(plan.scenes.length).toBeGreaterThanOrEqual(3);
  });

  it('still compiles Casa when the only camera is food', () => {
    const onlyFood = clips().filter((clip) => clip.role === 'food');
    const plan = compileProgram({
      clips: onlyFood,
      program: 'casa',
      peaksByCamera: peaks(),
    });
    expect(plan.scenes.length).toBeGreaterThanOrEqual(1);
    expect(plan.scenes.every((scene) => scene.role === 'food')).toBe(true);
  });

  it('clusters high-quality single-camera Casa takes around the live peak instead of touring the window', () => {
    const plan = compileProgram({
      clips: clips().map((clip) => ({
        ...clip,
        startOffsetSeconds: 0,
        windowDurationSeconds: 240,
      })),
      program: 'casa',
      peaksByCamera: new Map([['cam-1', [{ offsetSeconds: 18, fusedScore: 92 }]]]),
      cameraScores: new Map([
        [1, 88],
        [2, 12],
        [3, 28],
        [4, 18],
      ]),
      editMode: 'single_camera',
      compatiblePositions: new Set([1]),
    });
    const starts = plan.scenes.map((scene) => scene.source_start_offset);
    const span = Math.max(...starts) - Math.min(...starts);
    expect(plan.scenes.every((scene) => scene.position === 1)).toBe(true);
    expect(plan.scenes.length).toBeGreaterThanOrEqual(4);
    expect(span).toBeLessThan(55);
    expect(Math.max(...starts)).toBeLessThan(70);
    expect(plan.captionStrategy).toBe('none');
    expect(plan.duration).toBeGreaterThan(14);
    expect(plan.duration).toBeLessThan(70);
  });

  it('treats a strong Vision ranking as high-quality even if the editorial score is mid', () => {
    const plan = compileProgram({
      clips: clips().map((clip) => ({ ...clip, windowDurationSeconds: 38 })),
      program: 'casa',
      peaksByCamera: new Map(),
      analysis: {
        clips: [],
        score: 80,
        reason: 'C1 is the usable kitchen',
        detailedScores: { food: 70, action: 70, visual: 80, marketing: 60, ambience: 40 },
        scenes: [],
        captionPt: '',
        hashtags: [],
        provider: 'openai',
        cameraRankings: [
          { cameraPosition: 1, score: 88, reason: 'strong tandoor action' },
          { cameraPosition: 2, score: 20, reason: 'dark' },
        ],
      },
      cameraScores: new Map([
        [1, 65],
        [2, 23],
        [3, 54],
        [4, 0],
      ]),
      editMode: 'single_camera',
      compatiblePositions: new Set([1]),
    });
    const starts = plan.scenes.map((scene) => scene.source_start_offset);
    expect(plan.scenes.every((scene) => scene.position === 1)).toBe(true);
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(32);
  });

  it('keeps weak single-camera takes near the start of the window', () => {
    const plan = compileProgram({
      clips: clips().map((clip) => ({ ...clip, windowDurationSeconds: 38 })),
      program: 'casa',
      peaksByCamera: new Map(),
      cameraScores: new Map([
        [1, 40],
        [2, 12],
        [3, 18],
        [4, 10],
      ]),
      editMode: 'single_camera',
      compatiblePositions: new Set([1]),
    });
    const starts = plan.scenes.map((scene) => scene.source_start_offset);
    expect(Math.min(...starts)).toBeLessThan(8);
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(32);
  });

  it('still compiles Casa when the room camera is missing', () => {
    const plan = compileProgram({
      clips: clips().filter((clip) => clip.role !== 'ambience'),
      program: 'casa',
      peaksByCamera: peaks(),
    });
    expect(plan.scenes.length).toBeGreaterThanOrEqual(3);
    expect(plan.scenes.some((scene) => scene.role === 'ambience')).toBe(false);
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
    expect(playbookFor('pulso').beats[0]?.durationSeconds).toBeCloseTo(1.9);
  });

  it('copies beat fxAssetId and fxMode onto the Oficio plan', () => {
    const override = playbookFor('oficio');
    override.beats = override.beats.map((beat, index) =>
      index === 1 ? { ...beat, fxAssetId: 'whoosh-01', fxMode: 'auto' as const } : beat,
    );
    const plan = compileProgram({
      clips: clips(),
      program: 'oficio',
      peaksByCamera: peaks(),
      playbook: override,
    });
    expect(plan.scenes.some((scene) => scene.fxAssetId === 'whoosh-01')).toBe(true);
    expect(plan.scenes.some((scene) => scene.fxMode === 'auto')).toBe(true);
  });
});
