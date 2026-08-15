import { describe, expect, it } from 'vitest';
import {
  cropWindow9x16,
  ffmpegCropFromTrajectory,
  foodAwareTarget,
  lockSubject,
  rankCameras,
  shotStyleMotion,
  smoothCropTrajectory,
  snapCut,
  trackingQualityReport,
} from './quality-first.js';

describe('food-aware framing', () => {
  it('does not center only the face when a plate is in frame', () => {
    const target = foodAwareTarget({
      people: [{ detectorClass: 'person', confidence: 0.9, bbox: [100, 40, 80, 220] }],
      food: [{ detectorClass: 'bowl', confidence: 0.8, bbox: [200, 180, 120, 80] }],
      frameWidth: 480,
      frameHeight: 270,
      sceneRole: 'food_focus',
      shotStyle: 'cinematic_food_closeup',
    });
    expect(target.strategy).toBe('food_and_person');
    expect(target.x).toBeGreaterThan(140);
    expect(target.y).toBeGreaterThan(120);
  });
});

describe('subject lock', () => {
  it('does not switch A→B→A on a small score gap', () => {
    const observations = [];
    for (let t = 0; t <= 2000; t += 100) {
      observations.push({
        timeMs: t,
        trackId: 1,
        bbox: [80, 40, 110, 200] as [number, number, number, number],
        confidence: 0.92,
        className: 'person',
      });
      observations.push({
        timeMs: t,
        trackId: 2,
        bbox: [240, 50, 88, 176] as [number, number, number, number],
        confidence: 0.88,
        className: 'person',
      });
    }
    const locked = lockSubject(observations, { margin: 0.22, minLockMs: 900 });
    expect(locked.trackId).toBe(1);
    expect(locked.switches).toBe(0);
  });
});

describe('smart reframe', () => {
  it('keeps static strategy still and damps a moving subject', () => {
    const still = smoothCropTrajectory(
      [
        { timeMs: 0, x: 240, y: 135 },
        { timeMs: 400, x: 248, y: 138 },
        { timeMs: 800, x: 244, y: 133 },
      ],
      { width: 480, height: 270 },
      'static',
    );
    expect(still.keyframes).toHaveLength(1);
    const tracked = smoothCropTrajectory(
      [
        { timeMs: 0, x: 100, y: 120 },
        { timeMs: 200, x: 280, y: 120 },
        { timeMs: 400, x: 400, y: 120 },
      ],
      { width: 480, height: 270 },
      'tracked_subject',
    );
    const last = tracked.keyframes[tracked.keyframes.length - 1]!;
    expect(last.centerX).toBeLessThan(400);
    expect(ffmpegCropFromTrajectory(still, 3)).toContain('crop=');
    const [x, y, w, h] = cropWindow9x16(1920, 1080, 960, 540, 1);
    expect(w / h).toBeCloseTo(9 / 16, 2);
    expect(x).toBeGreaterThanOrEqual(0);
  });
});

describe('multicamera ranker', () => {
  it('does not let a dark food camera beat a well-lit master', () => {
    const ranked = rankCameras([
      {
        cameraPosition: 3,
        cameraRole: 'food',
        foodVisibility: 0.4,
        personVisibility: 0.1,
        lighting: 0.12,
        blur: 0.2,
        occlusion: 0.1,
        cropFeasibility: 0.5,
        trackingStability: 0.4,
        actionCompleteness: 0.4,
        visionScore: 80,
      },
      {
        cameraPosition: 1,
        cameraRole: 'master',
        foodVisibility: 0.55,
        personVisibility: 0.7,
        lighting: 0.72,
        blur: 0.15,
        occlusion: 0.1,
        cropFeasibility: 0.8,
        trackingStability: 0.7,
        actionCompleteness: 0.7,
        visionScore: 70,
      },
    ]);
    expect(ranked[0]?.cameraPosition).toBe(1);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });
});

describe('cut safety', () => {
  it('snaps away from a high-motion midpoint when a calmer frame is nearby', () => {
    const motion = [
      { timeMs: 1000, energy: 0.2 },
      { timeMs: 1200, energy: 0.9 },
      { timeMs: 1400, energy: 0.15 },
    ];
    const snapped = snapCut({
      proposedMs: 1200,
      windowStartMs: 0,
      windowEndMs: 5000,
      motion,
    });
    expect(snapped.changed).toBe(true);
    expect(snapped.timeMs).toBe(1400);
  });
});

describe('shot style and tracking qc', () => {
  it('maps slow_push to visible zoom and fails jittery tracking', () => {
    expect(shotStyleMotion('slow_push', 4).kind).toBe('slow_push');
    expect(shotStyleMotion('locked_static', 4).kind).toBe('none');
    const report = trackingQualityReport({
      locked: [],
      switches: 6,
      foodHits: 0,
      samples: 10,
      keyframes: [
        { timeMs: 0, centerX: 0, centerY: 0, scale: 1 },
        { timeMs: 100, centerX: 200, centerY: 0, scale: 1.2 },
      ],
      lostMs: 800,
    });
    expect(report.fallbackStatic).toBe(true);
  });
});
