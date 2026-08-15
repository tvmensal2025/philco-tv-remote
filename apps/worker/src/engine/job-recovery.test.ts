import { describe, expect, it } from 'vitest';
import {
  classifyQueueHealth,
  isLiveQueueJob,
  isStaleWorkerHeartbeat,
  lastProgressAtIso,
  planStaleRecovery,
  videoJobId,
} from './job-recovery.js';

describe('stale job recovery', () => {
  const now = Date.parse('2026-08-14T18:00:00.000Z');
  const staleMs = 120_000;

  it('uses the reel id as the stable logical job id', () => {
    expect(videoJobId('reel-1')).toBe('reel-1');
  });

  it('reclaims a zombie active job after last_progress goes stale', () => {
    expect(
      planStaleRecovery({
        status: 'analyzing',
        lastProgressAt: '2026-08-14T17:57:00.000Z',
        now,
        staleMs,
        queueHealth: 'zombie',
        recoveryCount: 0,
        maxRecoveries: 2,
      }),
    ).toBe('reclaim');
  });

  it('requeues when the BullMQ job is missing', () => {
    expect(
      planStaleRecovery({
        status: 'rendering',
        lastProgressAt: '2026-08-14T17:57:00.000Z',
        now,
        staleMs,
        queueHealth: 'missing',
        recoveryCount: 0,
        maxRecoveries: 2,
      }),
    ).toBe('requeue');
  });

  it('does not start a second render while a healthy job is live', () => {
    expect(
      planStaleRecovery({
        status: 'rendering',
        lastProgressAt: '2026-08-14T17:57:00.000Z',
        now,
        staleMs,
        queueHealth: 'live',
        recoveryCount: 0,
        maxRecoveries: 2,
      }),
    ).toBe('skip');
  });

  it('waits until last_progress is actually stale', () => {
    expect(
      planStaleRecovery({
        status: 'analyzing',
        lastProgressAt: '2026-08-14T17:59:30.000Z',
        now,
        staleMs,
        queueHealth: 'zombie',
        recoveryCount: 0,
        maxRecoveries: 2,
      }),
    ).toBe('skip');
  });

  it('treats an active job without a lock as dead', () => {
    expect(isLiveQueueJob({ state: 'active', hasLock: false })).toBe(false);
    expect(isLiveQueueJob({ state: 'active', hasLock: true })).toBe(true);
    expect(isLiveQueueJob({ state: 'waiting', hasLock: false })).toBe(true);
    expect(classifyQueueHealth({ state: 'active', hasLock: true, ownerWorkerFresh: true })).toBe(
      'live',
    );
    expect(classifyQueueHealth({ state: 'active', hasLock: true, ownerWorkerFresh: false })).toBe(
      'zombie',
    );
    expect(classifyQueueHealth({ state: 'active', hasLock: false, ownerWorkerFresh: true })).toBe(
      'zombie',
    );
    expect(classifyQueueHealth({ state: null, hasLock: false, ownerWorkerFresh: false })).toBe(
      'missing',
    );
  });

  it('fails after the recovery cap instead of looping', () => {
    expect(
      planStaleRecovery({
        status: 'rendering',
        lastProgressAt: '2026-08-14T17:50:00.000Z',
        now,
        staleMs,
        queueHealth: 'missing',
        recoveryCount: 2,
        maxRecoveries: 2,
      }),
    ).toBe('fail');
  });

  it('prefers metadata last_progress_at over updated_at', () => {
    expect(
      lastProgressAtIso(
        { last_progress_at: '2026-08-14T17:58:00.000Z' },
        '2026-08-14T17:00:00.000Z',
      ),
    ).toBe('2026-08-14T17:58:00.000Z');
    expect(lastProgressAtIso({}, '2026-08-14T17:00:00.000Z')).toBe('2026-08-14T17:00:00.000Z');
  });

  it('marks a missing worker heartbeat as stale', () => {
    expect(isStaleWorkerHeartbeat({ lastSeenAt: null, now, staleMs: 90_000 })).toBe(true);
    expect(
      isStaleWorkerHeartbeat({
        lastSeenAt: '2026-08-14T17:59:30.000Z',
        now,
        staleMs: 90_000,
      }),
    ).toBe(false);
  });
});
