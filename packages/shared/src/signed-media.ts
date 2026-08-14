import { createHmac, timingSafeEqual } from 'node:crypto';

export function signPublicReel(reelId: string, secret: string, ttlSeconds = 12 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac('sha256', secret).update(`${reelId}.${exp}`).digest('hex');
  return { exp, sig };
}

export function publicReelUrl(
  appUrl: string,
  reelId: string,
  secret: string,
  ttlSeconds = 12 * 3600,
) {
  const { exp, sig } = signPublicReel(reelId, secret, ttlSeconds);
  const origin = appUrl.replace(/\/$/, '');
  return `${origin}/api/public/reels/${reelId}?exp=${exp}&sig=${sig}`;
}

export function verifyPublicReel(reelId: string, exp: number, sig: string, secret: string) {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now() - 30_000) return false;
  if (!/^[a-f0-9]{64}$/i.test(sig)) return false;
  const expected = createHmac('sha256', secret).update(`${reelId}.${exp}`).digest('hex');
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(sig, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
