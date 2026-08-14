import { describe, expect, it } from 'vitest';
import { isFfmpegMemoryError, renderProfileOrder } from './render-profile.js';

describe('ffmpeg render profiles', () => {
  it('downgrades high → standard → safe', () => {
    expect(renderProfileOrder('high')).toEqual(['high', 'standard', 'safe']);
    expect(renderProfileOrder('standard')).toEqual(['standard', 'safe']);
    expect(renderProfileOrder('safe')).toEqual(['safe']);
  });

  it('recognizes the motion-filter OOM from eval=frame Ken Burns', () => {
    expect(
      isFfmpegMemoryError(new Error('ffmpeg (1): Error while filtering: Cannot allocate memory')),
    ).toBe(true);
    expect(isFfmpegMemoryError(new Error('NO_SCENES_IN_PLAN'))).toBe(false);
  });
});
