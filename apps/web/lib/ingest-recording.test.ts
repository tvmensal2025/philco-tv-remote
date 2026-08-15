import { describe, expect, it } from 'vitest';
import { isAllowedVideo, mp4DurationSeconds } from './ingest-video';

describe('phone and tape ingest guards', () => {
  it('rejects octet-stream without a video extension', () => {
    expect(
      isAllowedVideo({ type: 'application/octet-stream', size: 80_000, name: 'clip.bin' }),
    ).toBe(false);
    expect(
      isAllowedVideo({ type: 'application/octet-stream', size: 80_000, name: 'clip.mp4' }),
    ).toBe(true);
  });

  it('accepts phone camera types', () => {
    expect(isAllowedVideo({ type: 'video/quicktime', size: 80_000, name: 'IMG_001.MOV' })).toBe(
      true,
    );
    expect(isAllowedVideo({ type: '', size: 80_000, name: 'saida.m4v' })).toBe(true);
    expect(isAllowedVideo({ type: 'video/mp4', size: 100, name: 'tiny.mp4' })).toBe(false);
  });

  it('reads duration from an mvhd box', () => {
    const box = Buffer.alloc(24);
    Buffer.from('mvhd').copy(box, 0);
    box.writeUInt32BE(1000, 16);
    box.writeUInt32BE(45_000, 20);
    expect(mp4DurationSeconds(box)).toBe(45);
  });
});
