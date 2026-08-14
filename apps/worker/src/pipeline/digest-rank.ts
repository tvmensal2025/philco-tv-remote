import { calendarDay } from '@reelops/shared';

export type DigestReel = {
  id: string;
  title: string | null;
  caption: string | null;
  score: number | null;
  output_path: string | null;
  created_at: string;
  moments: { occurred_at: string } | { occurred_at: string }[] | null;
};

export function reelOccurredAt(reel: DigestReel) {
  const moment = Array.isArray(reel.moments) ? reel.moments[0] : reel.moments;
  return moment?.occurred_at ?? reel.created_at;
}

export function pickTopReels(reels: DigestReel[], day: string, timeZone: string, limit = 3) {
  return reels
    .filter((reel) => reel.output_path && calendarDay(reelOccurredAt(reel), timeZone) === day)
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, limit);
}
