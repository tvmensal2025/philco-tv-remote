import { describe, expect, it } from 'vitest';
import { parseYoloHealth, pickStableCrop, yoloModeForRole, fitSubjectCrop } from './yolo.js';

describe('yolo adapter', () => {
  it('maps camera roles to crop modes', () => {
    expect(yoloModeForRole('food')).toBe('plate');
    expect(yoloModeForRole('master')).toBe('person');
    expect(yoloModeForRole('side')).toBe('person');
    expect(yoloModeForRole('ambience')).toBe('auto');
  });

  it('ignores frame_center fallbacks when picking a crop', () => {
    const crop = pickStableCrop([
      {
        success: true,
        crop: { aspect: '9:16', bbox: [0, 0, 100, 100], anchor: 'frame_center', score: 0.1 },
      },
      {
        success: true,
        crop: { aspect: '9:16', bbox: [690, 0, 608, 1080], anchor: 'person_pose', score: 0.86 },
      },
    ]);
    expect(crop).toEqual([690, 0, 608, 1080]);
  });

  it('contains a standing person instead of centering on the frame', () => {
    const fitted = fitSubjectCrop([
      {
        success: true,
        frame: { width: 1280, height: 720 },
        people: [
          { bbox: [500, 400, 360, 220], is_full_body: false },
          { bbox: [380, 140, 220, 520], is_full_body: true },
        ],
        crop: { aspect: '9:16', bbox: [0, 0, 405, 720], anchor: 'frame_center', score: 0.1 },
      },
    ]);
    expect(fitted?.mode).toBe('crop');
    expect(fitted?.bbox[0]).toBeGreaterThan(200);
    expect(fitted!.bbox[0] + fitted!.bbox[2]).toBeGreaterThanOrEqual(380 + 220);
  });

  it('refuses a 480px vision bbox when the source size is unknown', () => {
    const fitted = fitSubjectCrop([
      {
        success: true,
        frame: { width: 480, height: 270 },
        people: [{ bbox: [45, 22, 135, 240], is_full_body: true }],
        crop: { aspect: '9:16', bbox: [120, 0, 152, 270], anchor: 'person_pose', score: 0.9 },
      },
    ]);
    expect(fitted).toBeUndefined();
  });

  it('scales a 480px vision bbox onto the 1280×720 source before contain', () => {
    const fitted = fitSubjectCrop(
      [
        {
          success: true,
          frame: { width: 480, height: 270 },
          people: [{ bbox: [45, 22, 135, 240], is_full_body: true }],
        },
      ],
      { width: 1280, height: 720 },
    );
    expect(fitted?.mode).toBe('pad_blur');
    expect(fitted!.bbox[2]).toBeGreaterThan(405);
    expect(fitted!.bbox[0] + fitted!.bbox[2]).toBeLessThanOrEqual(1280);
  });

  it('cuts a 9:16 Reels window on a wide singer instead of pad_blur', () => {
    const fitted = fitSubjectCrop(
      [
        {
          success: true,
          frame: { width: 480, height: 270 },
          people: [{ bbox: [45, 22, 135, 240], is_full_body: true }],
        },
      ],
      { width: 1280, height: 720 },
      { reels: true },
    );
    expect(fitted?.mode).toBe('crop');
    expect(fitted!.bbox[2]).toBeLessThanOrEqual(410);
    expect(fitted!.bbox[1]).toBe(0);
    expect(fitted!.bbox[3]).toBe(720);
    expect(fitted!.bbox[0] + fitted!.bbox[2]).toBeLessThanOrEqual(1280);
  });

  it('does not re-pad an already contained 9:16 YOLO window', () => {
    const fitted = fitSubjectCrop(
      [
        {
          success: true,
          frame: { width: 480, height: 270 },
          crop: {
            aspect: '9:16',
            bbox: [120, 0, 152, 270],
            anchor: 'person_pose',
            score: 0.9,
            mode: 'crop',
            tight: true,
          },
        },
      ],
      { width: 1280, height: 720 },
    );
    expect(fitted?.mode).toBe('crop');
    expect(fitted!.bbox[2]).toBeLessThanOrEqual(410);
    expect(fitted!.bbox[0] % 2).toBe(0);
    expect(fitted!.bbox[2] % 2).toBe(0);
  });

  it('rejects empty HTTP 200 as unhealthy', () => {
    expect(parseYoloHealth(null, 200).ok).toBe(false);
    expect(parseYoloHealth({}, 200).ok).toBe(false);
    expect(parseYoloHealth({ status: 'healthy' }, 200).ok).toBe(false);
    const healthy = parseYoloHealth(
      { status: 'healthy', device: 'cpu', models_loaded: { detect: true, pose: true } },
      200,
    );
    expect(healthy.ok).toBe(true);
    expect(healthy.loaded).toBe(true);
    expect(healthy.device).toBe('cpu');
  });
});
