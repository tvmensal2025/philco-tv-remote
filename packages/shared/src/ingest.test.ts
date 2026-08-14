import { describe, expect, it } from 'vitest';
import { decideIngestComplete, decideMomentCreate, recordingIdempotencyKey } from './ingest.js';

describe('recording idempotency key', () => {
  it('is stable for the same camera, checksum and window', () => {
    const first = recordingIdempotencyKey({
      cameraId: '11111111-1111-1111-1111-111111111111',
      checksum: 'abc',
      startedAt: '2026-08-14T16:42:00.000Z',
      endedAt: '2026-08-14T16:43:00.000Z',
    });
    const second = recordingIdempotencyKey({
      cameraId: '11111111-1111-1111-1111-111111111111',
      checksum: 'abc',
      startedAt: '2026-08-14T16:42:00.000Z',
      endedAt: '2026-08-14T16:43:00.000Z',
    });
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it('changes when the checksum changes', () => {
    const base = {
      cameraId: '11111111-1111-1111-1111-111111111111',
      startedAt: '2026-08-14T16:42:00.000Z',
      endedAt: '2026-08-14T16:43:00.000Z',
    };
    expect(recordingIdempotencyKey({ ...base, checksum: 'a' })).not.toBe(
      recordingIdempotencyKey({ ...base, checksum: 'b' }),
    );
  });
});

describe('ingest complete duplicate', () => {
  it('reuses the existing recording when the idempotency key already matched', () => {
    expect(decideIngestComplete('rec-1')).toEqual({ action: 'reuse', recordingId: 'rec-1' });
    expect(decideIngestComplete(null).action).toBe('upsert');
  });
});

describe('moment client request duplicate', () => {
  it('reuses the existing moment so a double click cannot enqueue eight reels', () => {
    expect(decideMomentCreate('mom-1')).toEqual({ action: 'reuse', momentId: 'mom-1' });
    expect(decideMomentCreate(undefined).action).toBe('insert');
  });
});
