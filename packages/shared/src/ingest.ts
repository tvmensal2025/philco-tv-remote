import { createHash } from 'node:crypto';

export const timestampSources = [
  'filename',
  'nvr_pattern',
  'file_metadata',
  'filesystem_mtime',
  'fallback',
] as const;
export type TimestampSource = (typeof timestampSources)[number];

export const timestampConfidences = ['exact', 'derived', 'fallback'] as const;
export type TimestampConfidence = (typeof timestampConfidences)[number];

export function recordingIdempotencyKey(input: {
  cameraId: string;
  checksum: string;
  startedAt: string;
  endedAt: string;
}) {
  return createHash('sha256')
    .update(`${input.cameraId}:${input.checksum}:${input.startedAt}:${input.endedAt}`)
    .digest('hex');
}

export function decideIngestComplete(existingId: string | null | undefined) {
  return existingId
    ? { action: 'reuse' as const, recordingId: existingId }
    : { action: 'upsert' as const };
}

export function decideMomentCreate(existingId: string | null | undefined) {
  return existingId
    ? { action: 'reuse' as const, momentId: existingId }
    : { action: 'insert' as const };
}
