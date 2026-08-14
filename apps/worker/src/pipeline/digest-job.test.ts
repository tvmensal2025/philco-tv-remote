import { pickTopReels, type DigestReel } from './digest-rank.js';
import { describe, expect, it } from 'vitest';

const tenantDay: DigestReel[] = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    title: 'Feijoada',
    caption: 'No balcão',
    score: 91,
    output_path: 'cenapronta/people/t/r/2026-08-13/reels/a/reel.mp4',
    created_at: '2026-08-13T18:00:00.000Z',
    moments: { occurred_at: '2026-08-13T18:10:00.000Z' },
  },
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    title: 'Sobremesa',
    caption: null,
    score: 88,
    output_path: 'cenapronta/people/t/r/2026-08-13/reels/b/reel.mp4',
    created_at: '2026-08-13T20:00:00.000Z',
    moments: { occurred_at: '2026-08-13T21:00:00.000Z' },
  },
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
    title: 'Salada',
    caption: null,
    score: 70,
    output_path: 'cenapronta/people/t/r/2026-08-13/reels/c/reel.mp4',
    created_at: '2026-08-13T22:00:00.000Z',
    moments: { occurred_at: '2026-08-13T22:30:00.000Z' },
  },
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
    title: 'Ontem',
    caption: null,
    score: 99,
    output_path: 'cenapronta/people/t/r/2026-08-12/reels/d/reel.mp4',
    created_at: '2026-08-12T21:00:00.000Z',
    moments: { occurred_at: '2026-08-12T21:00:00.000Z' },
  },
];

describe('daily digest ranking', () => {
  it('keeps only the top 3 reels of that restaurant calendar day', () => {
    const picked = pickTopReels(tenantDay, '2026-08-13', 'America/Sao_Paulo', 3);
    expect(picked.map((reel) => reel.title)).toEqual(['Feijoada', 'Sobremesa', 'Salada']);
  });
});
