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
  'collecting',
  'analyzing',
  'rendering',
  'uploading',
] as const;

export function planStaleRecovery(input: {
  status: string;
  updatedAt: string;
  now: number;
  staleMs: number;
  hasActiveJob: boolean;
  recoveryCount: number;
  maxRecoveries: number;
}): 'skip' | 'requeue' | 'fail' {
  if (!IN_FLIGHT_REEL_STATUSES.includes(input.status as (typeof IN_FLIGHT_REEL_STATUSES)[number]))
    return 'skip';
  if (input.hasActiveJob) return 'skip';
  if (input.now - Date.parse(input.updatedAt) < input.staleMs) return 'skip';
  if (input.recoveryCount >= input.maxRecoveries) return 'fail';
  return 'requeue';
}

export function recoveryCountFromMetadata(metadata: Record<string, unknown> | null | undefined) {
  const value = Number(metadata?.recovery_count ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function isLiveQueueJob(input: { state: string; hasLock: boolean }) {
  if (input.state === 'waiting' || input.state === 'delayed' || input.state === 'paused')
    return true;
  if (input.state === 'active') return input.hasLock;
  return false;
}
