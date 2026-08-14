import { describe, expect, it } from 'vitest';
import {
  calendarDay,
  cameraStoragePrefix,
  clockHour,
  dailyRankedReelPath,
  normalizeWhatsappPhone,
  rawSegmentPath,
  slugifyName,
} from './paths.js';

describe('cenapronta storage paths', () => {
  const tenant = '11111111-1111-1111-1111-111111111111';
  const restaurant = '22222222-2222-2222-2222-222222222222';

  it('keeps raw NVR footage away from the daily people/reels folder', () => {
    expect(cameraStoragePrefix(tenant, restaurant, 3)).toBe(
      `cenapronta/raw/${tenant}/${restaurant}/camera-3`,
    );
    expect(
      dailyRankedReelPath(tenant, restaurant, '2026-08-13', 1, restaurant, 'Feijoada no balcão'),
    ).toContain(`/people/${tenant}/${restaurant}/2026-08-13/reels/01-feijoada-no-balcao-`);
  });

  it('puts the segment in the Sao Paulo calendar day, not the UTC date', () => {
    const capturedAt = new Date('2026-08-14T02:30:00.000Z');
    const objectPath = rawSegmentPath(tenant, restaurant, 1, capturedAt);
    expect(objectPath).toBe(
      `cenapronta/raw/${tenant}/${restaurant}/camera-1/2026-08-13/${capturedAt.toISOString()}.mp4`,
    );
    expect(objectPath).not.toContain('/2026-08-14/');
  });

  it('formats the restaurant calendar day in America/Sao_Paulo', () => {
    expect(calendarDay('2026-08-14T02:30:00.000Z')).toBe('2026-08-13');
    expect(slugifyName('José da Silva')).toBe('jose-da-silva');
    expect(clockHour('2026-08-13T21:10:00-03:00')).toBe(21);
    expect(normalizeWhatsappPhone('+55 (11) 99999-9999')).toBe('5511999999999');
  });
});
