import { describe, expect, it } from 'vitest';
import type { MusicAnalysis } from '@reelops/shared';
import { assignStrategicFxAndSpeed, shouldAssignStrategicFx } from './fx-pass.js';
import type { ReelPlan } from './planner.js';

function musicAtDrop(startSeconds: number): MusicAnalysis {
  return {
    durationSeconds: 12,
    sampleRate: 22050,
    bpm: 120,
    beatPeriodSeconds: 0.5,
    timeSignature: 4,
    offsetSeconds: 0,
    confidence: 0.8,
    beats: [],
    downbeats: [],
    onsets: [],
    energyCurve: [{ timeSeconds: startSeconds, rms: 0.9 }],
    sections: [
      { startSeconds: 0, endSeconds: startSeconds, kind: 'intro', energy: 0.2 },
      { startSeconds, endSeconds: 12, kind: 'drop', energy: 0.9 },
    ],
  };
}

const plan: ReelPlan = {
  program: 'casa',
  join: 'dissolve',
  duration: 30,
  aspect_ratio: '9:16',
  scenes: [
    {
      camera_id: 'c1',
      source_recording_path: 'a.mp4',
      source_start_offset: 2,
      duration: 4,
      speed: 1,
      transition: 'cut',
      reason: 'hook',
      position: 1,
      hasAudio: true,
      role: 'food',
      punchIn: true,
      fxMode: 'auto',
    },
    {
      camera_id: 'c2',
      source_recording_path: 'b.mp4',
      source_start_offset: 4,
      duration: 4,
      speed: 1,
      transition: 'dissolve',
      reason: 'body',
      position: 2,
      hasAudio: false,
      role: 'master',
      fxMode: 'auto',
    },
  ],
  score: 70,
  detailedScores: { food: 70, action: 70, visual: 70, marketing: 50, ambience: 40 },
  reason: 'test',
  provider: 'heuristic',
};

describe('fx pass', () => {
  it('assigns one slow-mo on the peaked food take and skips smash on Casa', () => {
    const next = assignStrategicFxAndSpeed({
      plan,
      catalog: [
        {
          id: 'glass-smash-01',
          pack: 'smash',
          file: 'smash.webm',
          role: 'join',
          blend: 'alpha',
          durationMs: 700,
          tags: ['smash'],
        },
        {
          id: 'lens-01',
          pack: 'lens',
          file: 'lens.mov',
          role: 'lens',
          blend: 'screen',
          durationMs: 900,
          tags: ['lens'],
        },
      ],
      peaksByCamera: new Map([['c1', [{ offsetSeconds: 3.2, fusedScore: 40 }]]]),
      outputSeconds: 30,
    });
    expect(next.scenes[0]?.speed).toBe(0.5);
    expect(next.scenes.filter((scene) => scene.speed < 1)).toHaveLength(1);
    expect(next.scenes.some((scene) => scene.fxAssetId === 'glass-smash-01')).toBe(false);
  });

  it('does not slow a take without a real motion peak', () => {
    const next = assignStrategicFxAndSpeed({
      plan,
      catalog: [],
      peaksByCamera: new Map([['c1', [{ offsetSeconds: 3.2, fusedScore: 4 }]]]),
      outputSeconds: 30,
    });
    expect(next.scenes.every((scene) => scene.speed === 1)).toBe(true);
  });

  it('skips join packs on Casa when sfx density is low', () => {
    const next = assignStrategicFxAndSpeed({
      plan: {
        ...plan,
        scenes: plan.scenes.map((scene, index) =>
          index === 1 ? { ...scene, joinOverlay: 'flash' } : scene,
        ),
      },
      catalog: [
        {
          id: 'whoosh-01',
          pack: 'whoosh',
          file: 'whoosh.webm',
          role: 'join',
          blend: 'screen',
          durationMs: 700,
          tags: ['whoosh'],
        },
      ],
      peaksByCamera: new Map(),
      outputSeconds: 30,
      music: musicAtDrop(0),
      sfxDensity: 0.08,
    });
    expect(next.scenes[1]?.fxAssetId).toBeUndefined();
    expect(next.scenes[1]?.joinOverlay).toBe('flash');
  });

  it('assigns a join pack on the drop and clears the color overlay', () => {
    const next = assignStrategicFxAndSpeed({
      plan: {
        ...plan,
        program: 'pulso',
        scenes: plan.scenes.map((scene, index) =>
          index === 1 ? { ...scene, joinOverlay: 'flash' } : scene,
        ),
      },
      catalog: [
        {
          id: 'whoosh-01',
          pack: 'whoosh',
          file: 'whoosh.webm',
          role: 'join',
          blend: 'screen',
          durationMs: 700,
          tags: ['whoosh'],
        },
      ],
      peaksByCamera: new Map(),
      outputSeconds: 30,
      music: musicAtDrop(0),
      sfxDensity: 0.5,
    });
    expect(next.scenes[1]?.fxAssetId).toBe('whoosh-01');
    expect(next.scenes[1]?.joinOverlay).toBeUndefined();
  });

  it('does not assign strategic FX on Casa even when a beat asked for auto', () => {
    expect(shouldAssignStrategicFx('casa', [{ fxMode: 'auto' }])).toBe(false);
    expect(shouldAssignStrategicFx('pulso', [{ fxMode: 'auto' }])).toBe(true);
    expect(shouldAssignStrategicFx('oficio', [{ fxMode: 'none' }])).toBe(false);
  });
});
