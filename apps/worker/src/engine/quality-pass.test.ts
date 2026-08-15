import { describe, expect, it } from 'vitest';
import {
  applyCutSafety,
  applySmartReframe,
  mapDetectionsToSource,
  scoresFromRanker,
} from './quality-pass.js';
import type { ReelPlanScene } from './planner.js';

const scene = (overrides: Partial<ReelPlanScene> = {}): ReelPlanScene => ({
  camera_id: 'cam-1',
  source_recording_path: '/tmp/a.mp4',
  source_start_offset: 1.2,
  duration: 4,
  speed: 1,
  transition: 'dissolve',
  reason: 'hook',
  position: 1,
  hasAudio: true,
  role: 'master',
  ...overrides,
});

describe('quality pass', () => {
  it('maps ranker rows to camera scores', () => {
    const scores = scoresFromRanker([
      {
        cameraPosition: 3,
        cameraRole: 'food',
        foodVisibility: 0.2,
        personVisibility: 0,
        lighting: 0.1,
        blur: 0.4,
        occlusion: 0.2,
        cropFeasibility: 0.3,
        trackingStability: 0.2,
        actionCompleteness: 0.2,
      },
      {
        cameraPosition: 1,
        cameraRole: 'master',
        foodVisibility: 0.6,
        personVisibility: 0.7,
        lighting: 0.8,
        blur: 0.1,
        occlusion: 0.1,
        cropFeasibility: 0.8,
        trackingStability: 0.7,
        actionCompleteness: 0.7,
      },
    ]);
    expect(scores.get(1)!).toBeGreaterThan(scores.get(3)!);
  });

  it('keeps the original crop when tracking has no detections', () => {
    const original = scene({ crop: [10, 0, 100, 180] });
    const next = applySmartReframe(original, {
      people: [],
      food: [],
      tracks: [],
      frameWidth: 480,
      frameHeight: 270,
      enableTracking: false,
    });
    expect(next.crop).toEqual([10, 0, 100, 180]);
  });

  it('does not 9:16-clip a person who is wider than the slice', () => {
    const next = applySmartReframe(scene({ crop: [400, 0, 405, 720] }), {
      people: [
        {
          detectorClass: 'person',
          confidence: 0.9,
          bbox: [120, 60, 360, 640],
        },
      ],
      food: [],
      tracks: [],
      frameWidth: 1280,
      frameHeight: 720,
      enableTracking: true,
    });
    expect(next.cropMode).toBe('pad_blur');
    expect(next.cropTight).toBe(true);
    expect(next.cropFilter).toBeUndefined();
    expect((next.crop?.[2] ?? 0) > 405).toBe(true);
  });

  it('leaves a tight contain crop alone', () => {
    const original = scene({
      crop: [320, 0, 405, 720],
      cropMode: 'crop',
      cropTight: true,
    });
    const next = applySmartReframe(original, {
      people: [{ detectorClass: 'person', confidence: 0.9, bbox: [400, 80, 200, 500] }],
      food: [],
      tracks: [],
      frameWidth: 1280,
      frameHeight: 720,
      enableTracking: true,
    });
    expect(next.crop).toEqual([320, 0, 405, 720]);
    expect(next.cropTight).toBe(true);
  });

  it('leaves a pad_blur contain crop alone', () => {
    const original = scene({
      crop: [77, 0, 446, 720],
      cropMode: 'pad_blur',
      cropTight: true,
    });
    const next = applySmartReframe(original, {
      people: [{ detectorClass: 'person', confidence: 0.9, bbox: [400, 80, 200, 500] }],
      food: [],
      tracks: [],
      frameWidth: 1280,
      frameHeight: 720,
      enableTracking: true,
    });
    expect(next.crop).toEqual([77, 0, 446, 720]);
    expect(next.cropMode).toBe('pad_blur');
  });

  it('maps 720p tracking boxes onto a 1920×1080 source', () => {
    const mapped = mapDetectionsToSource(
      [{ bbox: [80, 40, 240, 426] as [number, number, number, number] }],
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
    );
    expect(mapped[0]!.bbox[0]).toBeCloseTo(120, 0);
    expect(mapped[0]!.bbox[2]).toBeCloseTo(360, 0);
    expect(mapped[0]!.bbox[3]).toBeCloseTo(639, 0);
  });

  it('snaps a cut using peak energy', () => {
    const scenes = applyCutSafety(
      [scene({ source_start_offset: 1.2, camera_id: 'cam-1' })],
      new Map([
        [
          'cam-1',
          [
            { offsetSeconds: 1.2, fusedScore: 0.9 },
            { offsetSeconds: 1.5, fusedScore: 0.1 },
          ],
        ],
      ]),
      new Map([['cam-1', { start: 0, duration: 20 }]]),
    );
    expect(scenes[0]?.source_start_offset).toBeCloseTo(1.5, 1);
  });
});
