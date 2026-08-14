import { describe, expect, it } from 'vitest';
import { pickStableCrop, yoloModeForRole } from './yolo.js';

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
});
