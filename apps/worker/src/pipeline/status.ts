import { AsyncLocalStorage } from 'node:async_hooks';
import type { ReelStatus } from '@reelops/shared';
import { canCommitExecution, canOverwriteTerminalStatus } from '../engine/execution-token.js';
import { db } from '../services.js';

export type ReelClaim = {
  executionId: string;
  workerId: string;
};

export class StaleExecutionError extends Error {
  constructor() {
    super('STALE_EXECUTION');
    this.name = 'StaleExecutionError';
  }
}

const claimStore = new AsyncLocalStorage<ReelClaim>();

export function withReelClaim<T>(claim: ReelClaim, fn: () => Promise<T>) {
  return claimStore.run(claim, fn);
}

export function currentReelClaim() {
  return claimStore.getStore();
}

function mergeMetadata(
  current: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | undefined,
  claim?: ReelClaim,
) {
  const merged: Record<string, unknown> = { ...(current ?? {}), ...(incoming ?? {}) };
  merged.last_progress_at = new Date().toISOString();
  if (claim) {
    merged.execution_id = claim.executionId;
    merged.owner_worker_id = claim.workerId;
  }
  return merged;
}

export async function beginReelExecution(input: {
  tenantId: string;
  reelId: string;
  executionId: string;
  workerId: string;
}) {
  const { data, error } = await db
    .from('reels')
    .select('id,status,metadata')
    .eq('id', input.reelId)
    .eq('tenant_id', input.tenantId)
    .single();
  if (error || !data) throw error ?? new Error('REEL_NOT_FOUND');
  if (['ready', 'approved', 'publishing', 'published', 'discarded'].includes(data.status)) {
    throw new StaleExecutionError();
  }
  const metadata = mergeMetadata(data.metadata as Record<string, unknown> | null, undefined, {
    executionId: input.executionId,
    workerId: input.workerId,
  });
  const { error: updateError } = await db
    .from('reels')
    .update({ metadata })
    .eq('id', input.reelId)
    .eq('tenant_id', input.tenantId);
  if (updateError) throw updateError;
  return { executionId: input.executionId, workerId: input.workerId } satisfies ReelClaim;
}

export async function setStatus(
  tenantId: string,
  reelId: string,
  status: ReelStatus,
  progress: number,
  message: string,
  extra: Record<string, unknown> = {},
) {
  const claim = claimStore.getStore();
  const { data: current, error: readError } = await db
    .from('reels')
    .select('id,status,metadata')
    .eq('id', reelId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (readError) throw readError;
  const currentMeta = (current?.metadata as Record<string, unknown> | null) ?? {};
  if (
    claim &&
    !canCommitExecution(currentMeta.execution_id as string | undefined, claim.executionId)
  ) {
    throw new StaleExecutionError();
  }
  if (
    claim &&
    current &&
    !canOverwriteTerminalStatus(current.status) &&
    status !== current.status
  ) {
    throw new StaleExecutionError();
  }
  const extraCopy = { ...extra };
  const incomingMeta = extraCopy.metadata as Record<string, unknown> | undefined;
  delete extraCopy.metadata;
  const metadata = mergeMetadata(currentMeta, incomingMeta, claim);
  const update: Record<string, unknown> = { status, progress, ...extraCopy, metadata };
  let query = db.from('reels').update(update).eq('id', reelId).eq('tenant_id', tenantId);
  if (claim && typeof currentMeta.execution_id === 'string') {
    query = query.filter('metadata->>execution_id', 'eq', claim.executionId);
  }
  const { data: updated, error } = await query.select('id');
  if (error) throw error;
  if (claim && typeof currentMeta.execution_id === 'string' && !updated?.length) {
    throw new StaleExecutionError();
  }
  const { error: eventError } = await db
    .from('job_events')
    .insert({ tenant_id: tenantId, reel_id: reelId, status, progress, message, payload: extra });
  if (eventError) throw eventError;
}
