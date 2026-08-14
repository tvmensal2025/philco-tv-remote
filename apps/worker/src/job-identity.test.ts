import { describe, expect, it } from 'vitest';
import { isDuplicateJobError } from './job-identity.js';

describe('crash recovery job identity', () => {
  it('treats a BullMQ duplicate jobId as the same reel, not a second insert', () => {
    expect(isDuplicateJobError(new Error('Job video-pipeline:abc already exists'))).toBe(true);
    expect(isDuplicateJobError(new Error('REDIS_DOWN'))).toBe(false);
  });
});
