import { describe, expect, it } from 'vitest';
import { licensedMusicBeds, pickMusicBed } from './music-bed.js';

describe('owned music beds', () => {
  it('loads musica1 and musica2 as owned Sofia Veo tracks', () => {
    const beds = licensedMusicBeds();
    expect(beds.map((bed) => bed.assetId).sort()).toEqual(['musica1', 'musica2']);
    expect(beds.every((bed) => bed.licenseType === 'owned' && bed.licenseReference)).toBe(true);
  });

  it('picks a stable bed from the reel id', () => {
    expect(pickMusicBed('reel-a')?.assetId).toBe(pickMusicBed('reel-a')?.assetId);
    expect(['musica1', 'musica2']).toContain(pickMusicBed('reel-a')?.assetId);
  });
});
