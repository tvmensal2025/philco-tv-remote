import type { ReelStatus } from '@reelops/shared';
import { db } from '../services.js';
export async function setStatus(
  tenantId: string,
  reelId: string,
  status: ReelStatus,
  progress: number,
  message: string,
  extra: Record<string, unknown> = {},
) {
  const update: Record<string, unknown> = { status, progress, ...extra };
  const { error } = await db
    .from('reels')
    .update(update)
    .eq('id', reelId)
    .eq('tenant_id', tenantId);
  if (error) throw error;
  const { error: eventError } = await db
    .from('job_events')
    .insert({ tenant_id: tenantId, reel_id: reelId, status, progress, message, payload: extra });
  if (eventError) throw eventError;
}
