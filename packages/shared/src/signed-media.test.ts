import { publicReelUrl, signPublicReel, verifyPublicReel } from './signed-media.js';
import { describe, expect, it } from 'vitest';

describe('signed public reel URLs', () => {
  it('accepts a fresh signature and rejects a tampered one', () => {
    const secret = 'a'.repeat(24);
    const reelId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const { exp, sig } = signPublicReel(reelId, secret, 60);
    expect(verifyPublicReel(reelId, exp, sig, secret)).toBe(true);
    expect(verifyPublicReel(reelId, exp, 'b'.repeat(64), secret)).toBe(false);
    expect(publicReelUrl('https://reels.example.com/', reelId, secret, 60)).toContain(
      `/api/public/reels/${reelId}?exp=`,
    );
  });
});
