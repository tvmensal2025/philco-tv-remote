import { describe, expect, it } from 'vitest';
import { isLiveQueueJob, planStaleRecovery } from './job-recovery.js';

describe('stale job recovery', () => {
  const now = Date.parse('2026-08-14T18:00:00.000Z');
  const staleMs = 18 * 60 * 1000;

  it('requeues a rendering reel with no active BullMQ job', () => {
    expect(
      planStaleRecovery({
        status: 'rendering',
        updatedAt: '2026-08-14T17:30:00.000Z',
        now,
        staleMs,
        hasActiveJob: false,
        recoveryCount: 0,
        maxRecoveries: 2,
      }),
    ).toBe('requeue');
  });

  it('does not start a second render while a job is active', () => {
    expect(
      planStaleRecovery({
        status: 'rendering',
        updatedAt: '2026-08-14T17:30:00.000Z',
        now,
        staleMs,
        hasActiveJob: true,
        recoveryCount: 0,
        maxRecoveries: 2,
      }),
    ).toBe('skip');
  });

  it('treats an active job without a lock as dead', () => {
    expect(isLiveQueueJob({ state: 'active', hasLock: false })).toBe(false);
    expect(isLiveQueueJob({ state: 'active', hasLock: true })).toBe(true);
    expect(isLiveQueueJob({ state: 'waiting', hasLock: false })).toBe(true);
  });

  it('fails after the recovery cap instead of looping', () => {
    expect(
      planStaleRecovery({
        status: 'rendering',
        updatedAt: '2026-08-14T17:30:00.000Z',
        now,
        staleMs,
        hasActiveJob: false,
        recoveryCount: 2,
        maxRecoveries: 2,
      }),
    ).toBe('fail');
  });
});
