import { describe, expect, it } from 'vitest';
import { isTenantMediaPath } from '@reelops/shared';

describe('tenant media authorization', () => {
  const a = '6399a79c-6b2d-4672-9132-3870bf5e0fbc';
  const b = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  it('does not authorize Tenant B to stream Tenant A recordings or reels', () => {
    const recording = `cenapronta/raw/${a}/dbd3c84b-aa9d-40df-8245-259d27a83292/camera-1/2026-08-14/file.mp4`;
    const reel = `cenapronta/people/${a}/dbd3c84b-aa9d-40df-8245-259d27a83292/2026-08-14/reels/x/reel.mp4`;
    expect(isTenantMediaPath(recording, a)).toBe(true);
    expect(isTenantMediaPath(reel, a)).toBe(true);
    expect(isTenantMediaPath(recording, b)).toBe(false);
    expect(isTenantMediaPath(reel, b)).toBe(false);
  });
});
