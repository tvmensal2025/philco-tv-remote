import { describe, expect, it } from 'vitest';
import { restaurantOpsStatus } from './restaurant-ops';

const now = Date.parse('2026-08-14T18:00:00.000Z');

describe('restaurant ops status', () => {
  it('is live when every enabled camera sent a segment in the last 20 minutes', () => {
    const status = restaurantOpsStatus({
      now,
      cameras: [1, 2, 3, 4].map(() => ({
        enabled: true,
        last_seen_at: '2026-08-14T17:50:00.000Z',
      })),
      reelsToday: [{ status: 'ready' }],
    });
    expect(status.code).toBe('live');
    expect(status.camerasOnline).toBe(4);
  });

  it('is never when onboarded cameras have never sent a segment', () => {
    const status = restaurantOpsStatus({
      now,
      cameras: [1, 2, 3, 4].map(() => ({ enabled: true, last_seen_at: null })),
      reelsToday: [],
    });
    expect(status.code).toBe('never');
  });

  it('is silent when the last segment is older than three hours', () => {
    const status = restaurantOpsStatus({
      now,
      cameras: [1, 2, 3, 4].map(() => ({
        enabled: true,
        last_seen_at: '2026-08-14T12:00:00.000Z',
      })),
      reelsToday: [],
    });
    expect(status.code).toBe('silent');
  });

  it('is degraded when one camera is late or a reel failed today', () => {
    const cameras = [
      { enabled: true, last_seen_at: '2026-08-14T17:50:00.000Z' },
      { enabled: true, last_seen_at: '2026-08-14T17:50:00.000Z' },
      { enabled: true, last_seen_at: '2026-08-14T17:50:00.000Z' },
      { enabled: true, last_seen_at: '2026-08-14T17:20:00.000Z' },
    ];
    expect(restaurantOpsStatus({ now, cameras, reelsToday: [] }).code).toBe('degraded');
    expect(
      restaurantOpsStatus({
        now,
        cameras: cameras.map((camera) => ({ ...camera, last_seen_at: '2026-08-14T17:50:00.000Z' })),
        reelsToday: [{ status: 'failed' }],
      }).code,
    ).toBe('degraded');
  });
});
