import { describe, expect, it } from 'vitest';
import {
  containFullFrame,
  containSubjectCrop,
  cropNeedsPadBlur,
  isDeliverySourceCrop,
  isStandingDeliveryCrop,
  lockScenesToLiveSubject,
  mapBoxToFrame,
  pickStandingSubject,
} from './crop.js';

describe('containSubjectCrop', () => {
  it('places the 9:16 window so a left-side person is fully inside', () => {
    const crop = containSubjectCrop({
      frameWidth: 1280,
      frameHeight: 720,
      subject: { x: 380, y: 140, w: 280, h: 520 },
    });
    expect(crop.mode).toBe('crop');
    const [x, y, w, h] = crop.bbox;
    expect(y).toBe(0);
    expect(h).toBe(720);
    expect(w / h).toBeCloseTo(9 / 16, 1);
    expect(x).toBeGreaterThan(200);
    expect(x % 2).toBe(0);
    expect(w % 2).toBe(0);
    expect(x + w).toBeLessThanOrEqual(1280);
    expect(x).toBeLessThanOrEqual(380);
    expect(x + w).toBeGreaterThanOrEqual(380 + 280);
  });

  it('does not left-lock the window on logos when the subject is mid-frame', () => {
    const crop = containSubjectCrop({
      frameWidth: 1280,
      frameHeight: 720,
      subject: { x: 420, y: 120, w: 240, h: 540 },
    });
    expect(crop.bbox[0]).toBeGreaterThan(80);
  });

  it('uses pad_blur when the body is wider than the 9:16 slice', () => {
    const crop = containSubjectCrop({
      frameWidth: 1280,
      frameHeight: 720,
      subject: { x: 100, y: 80, w: 700, h: 600 },
    });
    expect(crop.mode).toBe('pad_blur');
    expect(crop.tight).toBe(true);
    expect(crop.bbox[2]).toBeGreaterThan(405);
  });

  it('keeps a pad_blur bbox inside the source so ffmpeg crop cannot overshoot', () => {
    const crop = containSubjectCrop({
      frameWidth: 1280,
      frameHeight: 720,
      subject: { x: 900, y: 10, w: 370, h: 700 },
    });
    const [x, y, w, h] = crop.bbox;
    expect(crop.mode).toBe('pad_blur');
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(1280);
    expect(y + h).toBeLessThanOrEqual(720);
    expect(w % 2).toBe(0);
    expect(h % 2).toBe(0);
    expect(x % 2).toBe(0);
    expect(y % 2).toBe(0);
  });

  it('infers pad_blur from a wide bbox even when cropMode is missing', () => {
    expect(cropNeedsPadBlur({ crop: [77, 0, 446, 720] })).toBe(true);
    expect(cropNeedsPadBlur({ bbox: [77, 0, 446, 720] })).toBe(true);
    expect(cropNeedsPadBlur({ crop: [400, 0, 405, 720] })).toBe(false);
    expect(cropNeedsPadBlur({ cropMode: 'pad_blur', crop: [400, 0, 405, 720] })).toBe(true);
  });

  it('maps a 480-wide vision box onto the 1280×720 source', () => {
    const mapped = mapBoxToFrame(
      { x: 45, y: 22.5, w: 135, h: 240 },
      { width: 480, height: 270 },
      { width: 1280, height: 720 },
    );
    expect(mapped.x).toBeCloseTo(120, 0);
    expect(mapped.w).toBeCloseTo(360, 0);
    expect(mapped.h).toBeCloseTo(640, 0);
    const crop = containSubjectCrop({
      frameWidth: 1280,
      frameHeight: 720,
      subject: mapped,
    });
    expect(crop.mode).toBe('pad_blur');
    expect(crop.bbox[2]).toBeGreaterThan(405);
  });

  it('prefers a standing person over a seated blob', () => {
    const picked = pickStandingSubject([
      { bbox: [500, 400, 360, 220], is_full_body: false },
      { bbox: [380, 140, 220, 520], is_full_body: true },
    ]);
    expect(picked).toEqual({ x: 380, y: 140, w: 220, h: 520 });
  });
});

describe('isDeliverySourceCrop', () => {
  it('rejects 480px vision windows that would slice the HD source', () => {
    expect(isDeliverySourceCrop([60, 0, 151, 270])).toBe(false);
    expect(isDeliverySourceCrop([0, 1, 480, 853])).toBe(false);
    expect(isDeliverySourceCrop([0, 0, 480, 270])).toBe(false);
  });

  it('accepts 720p and 1080p 9:16 windows', () => {
    expect(isDeliverySourceCrop([400, 0, 405, 720])).toBe(true);
    expect(isDeliverySourceCrop([77, 0, 446, 720])).toBe(true);
    expect(isDeliverySourceCrop([690, 0, 608, 1080])).toBe(true);
  });
});

describe('lockScenesToLiveSubject', () => {
  const frame = { width: 1280, height: 720 };

  it('keeps a standing 9:16 and rejects a feet box', () => {
    expect(isStandingDeliveryCrop([204, 0, 406, 720], frame)).toBe(true);
    expect(isStandingDeliveryCrop([496, 294, 412, 426], frame)).toBe(false);
  });

  it('keeps a standing crop only on that take and contains later dead boxes', () => {
    const locked = lockScenesToLiveSubject(
      [
        {
          camera_id: 'c1',
          crop: [204, 0, 406, 720],
          cropMode: 'crop' as const,
          cropFilter: 'crop=60:270:0:0',
        },
        {
          camera_id: 'c1',
          crop: [496, 294, 412, 426],
          cropMode: 'pad_blur' as const,
          cropTight: true,
        },
        {
          camera_id: 'c1',
          crop: [560, 0, 406, 720],
          cropMode: 'crop' as const,
        },
      ],
      () => frame,
    );
    const fallback = containFullFrame(frame);
    expect(locked[0]?.crop).toEqual([204, 0, 406, 720]);
    expect(locked[0]?.cropMode).toBe('crop');
    expect(locked[1]?.crop).toEqual(fallback.bbox);
    expect(locked[1]?.cropMode).toBe(fallback.mode);
    expect(locked[2]?.crop).toEqual([560, 0, 406, 720]);
    expect(locked.every((scene) => scene.cropFilter === undefined)).toBe(true);
  });

  it('contains every Casa take even when a standing 9:16 exists', () => {
    const locked = lockScenesToLiveSubject(
      [
        {
          camera_id: 'c1',
          crop: [204, 0, 406, 720],
          cropMode: 'crop' as const,
        },
      ],
      () => frame,
      { containAll: true },
    );
    const fallback = containFullFrame(frame);
    expect(locked[0]?.crop).toEqual(fallback.bbox);
    expect(locked[0]?.cropMode).toBe(fallback.mode);
  });

  it('falls back to full-frame contain when no standing crop exists', () => {
    const locked = lockScenesToLiveSubject(
      [{ camera_id: 'c1', crop: [496, 294, 412, 426], cropMode: 'pad_blur' as const }],
      () => frame,
    );
    const fallback = containFullFrame(frame);
    expect(locked[0]?.cropMode).toBe(fallback.mode);
    expect(locked[0]?.crop).toEqual(fallback.bbox);
  });
});
