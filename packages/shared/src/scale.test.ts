import { describe, expect, it } from 'vitest';
import {
  MemoryCounterStore,
  acquireTenantSlot,
  canPromoteFinalOutput,
  censusWorkers,
  classifyWorkerEnvironment,
  executionObjectKeys,
  oldestWaitingAgeSeconds,
  queuePressure,
  releaseTenantSlot,
  simulateFairDrain,
  storageQuotaState,
  jitterBackoffMs,
  workerHealthOk,
} from './scale.js';

describe('worker census', () => {
  it('does not let a development worker mask missing production', () => {
    expect(classifyWorkerEnvironment('Rafael')).toBe('development');
    expect(classifyWorkerEnvironment('e7f3836bf967')).toBe('production');
    const now = Date.parse('2026-08-15T01:00:00.000Z');
    const census = censusWorkers(
      [
        {
          id: 'Rafael-1',
          last_seen_at: '2026-08-15T00:59:50.000Z',
          metadata: { hostname: 'Rafael', environment: 'development' },
        },
        {
          id: 'dead-vps',
          last_seen_at: '2026-08-14T20:00:00.000Z',
          metadata: { hostname: 'e7f3836bf967', environment: 'production' },
        },
      ],
      now,
    );
    expect(census.live_count).toBe(1);
    expect(census.production.live).toBe(0);
    expect(census.production_masked_by_dev).toBe(true);
    expect(workerHealthOk(census, true)).toBe(false);
    expect(workerHealthOk(census, false)).toBe(true);
  });
});

describe('tenant fairness', () => {
  it('caps concurrent slots per tenant', async () => {
    const store = new MemoryCounterStore();
    const first = await acquireTenantSlot(store, 'tenant-a', 'render', 1);
    const second = await acquireTenantSlot(store, 'tenant-a', 'render', 1);
    const other = await acquireTenantSlot(store, 'tenant-b', 'render', 1);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(other.ok).toBe(true);
    await releaseTenantSlot(store, 'tenant-a', 'render');
    const retry = await acquireTenantSlot(store, 'tenant-a', 'render', 1);
    expect(retry.ok).toBe(true);
  });

  it('does not starve small tenants when one floods', () => {
    const jobs = [
      ...Array.from({ length: 500 }, () => ({ tenantId: 'A', enqueuedAt: 0 })),
      ...Array.from({ length: 100 }, (_, index) => ({
        tenantId: `t${index}`,
        enqueuedAt: 0,
      })),
    ];
    const result = simulateFairDrain({ jobs, slots: 2, maxPerTenant: 1, tickMs: 1000 });
    const small = result.byTenant.t0;
    const flood = result.byTenant.A;
    expect(small).toBeTruthy();
    expect(flood).toBeTruthy();
    expect(small!.max).toBeLessThanOrEqual(flood!.max);
    expect(small!.mean).toBeLessThan(flood!.mean);
  });
});

describe('output commit', () => {
  it('keeps canonical keys stable and blocks late attempt promote', () => {
    const keys = executionObjectKeys('cenapronta/people/t/r/2026-08-13/reels/reel-1', 'exec-b');
    expect(keys.canonicalVideo.endsWith('/reel.mp4')).toBe(true);
    expect(keys.stagingVideo.includes('/.exec/exec-b/')).toBe(true);
    expect(canPromoteFinalOutput('exec-b', 'exec-b')).toBe(true);
    expect(canPromoteFinalOutput('exec-b', 'exec-a')).toBe(false);
  });
});

describe('queue pressure', () => {
  it('flags saturation from waiting age and full slots', () => {
    expect(oldestWaitingAgeSeconds([Date.now() - 180_000])).toBeGreaterThanOrEqual(179);
    const pressure = queuePressure({
      waiting: 12,
      active: 2,
      oldestAgeSeconds: 180,
      workerSlots: 2,
    });
    expect(pressure.pressure).toBe('high');
  });
});

describe('storage quota domain', () => {
  it('does not enforce when quota is unset', () => {
    expect(storageQuotaState(9_000, 0).exceeded).toBe(false);
    expect(storageQuotaState(9_000, 8_000).exceeded).toBe(true);
    expect(storageQuotaState(1_000, 8_000).remainingBytes).toBe(7_000);
  });
});

describe('retry jitter', () => {
  it('spreads retries instead of aligning them', () => {
    const samples = Array.from({ length: 40 }, () => jitterBackoffMs(3, 1_000, 8_000));
    expect(new Set(samples).size).toBeGreaterThan(1);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(4_000);
    expect(Math.max(...samples)).toBeLessThanOrEqual(8_000);
  });
});
