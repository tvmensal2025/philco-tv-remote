export type StaleReel = {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  moment_id: string;
  status: string;
  updated_at: string;
  metadata?: Record<string, unknown> | null;
  moments?: {
    occurred_at: string;
    window_start: string;
    window_end: string;
  } | null;
};

export const IN_FLIGHT_REEL_STATUSES = [
  'queued',
  'collecting',
  'analyzing',
  'rendering',
  'uploading',
] as const;

export type QueueHealth = 'live' | 'zombie' | 'missing';
export type StaleRecoveryAction = 'skip' | 'reclaim' | 'requeue' | 'fail';

export function videoJobId(reelId: string) {
  return reelId;
}

export function lastProgressAtIso(
  metadata: Record<string, unknown> | null | undefined,
  updatedAt: string,
) {
  const raw = metadata?.last_progress_at;
  if (typeof raw === 'string' && Number.isFinite(Date.parse(raw))) return raw;
  return updatedAt;
}

export function recoveryCountFromMetadata(metadata: Record<string, unknown> | null | undefined) {
  const value = Number(metadata?.recovery_count ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function ownerWorkerId(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata?.owner_worker_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function isLiveQueueJob(input: { state: string; hasLock: boolean }) {
  if (input.state === 'waiting' || input.state === 'delayed' || input.state === 'paused')
    return true;
  if (input.state === 'active') return input.hasLock;
  return false;
}

export function classifyQueueHealth(input: {
  state: string | null;
  hasLock: boolean;
  ownerWorkerFresh: boolean;
}): QueueHealth {
  if (
    !input.state ||
    input.state === 'unknown' ||
    input.state === 'failed' ||
    input.state === 'completed'
  ) {
    return 'missing';
  }
  if (input.state === 'waiting' || input.state === 'delayed' || input.state === 'paused')
    return 'live';
  if (input.state === 'active' && input.hasLock && input.ownerWorkerFresh) return 'live';
  if (input.state === 'active') return 'zombie';
  return 'missing';
}

export function planStaleRecovery(input: {
  status: string;
  lastProgressAt: string;
  now: number;
  staleMs: number;
  queueHealth: QueueHealth;
  recoveryCount: number;
  maxRecoveries: number;
}): StaleRecoveryAction {
  if (!IN_FLIGHT_REEL_STATUSES.includes(input.status as (typeof IN_FLIGHT_REEL_STATUSES)[number])) {
    return 'skip';
  }
  if (input.now - Date.parse(input.lastProgressAt) < input.staleMs) return 'skip';
  if (input.recoveryCount >= input.maxRecoveries) return 'fail';
  if (input.queueHealth === 'live') return 'skip';
  if (input.queueHealth === 'zombie') return 'reclaim';
  return 'requeue';
}

export function isStaleWorkerHeartbeat(input: {
  lastSeenAt: string | null;
  now: number;
  staleMs: number;
}) {
  if (!input.lastSeenAt) return true;
  const seen = Date.parse(input.lastSeenAt);
  if (!Number.isFinite(seen)) return true;
  return input.now - seen >= input.staleMs;
}
