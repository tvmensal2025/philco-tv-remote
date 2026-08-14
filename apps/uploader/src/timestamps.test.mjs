import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FilenameTimestampResolver,
  FileMetadataTimestampResolver,
  FallbackTimestampResolver,
  NvrPatternTimestampResolver,
  parseCompactStamp,
  resolveTimestamp,
} from './timestamps.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('TimestampResolver', () => {
  it('parses canonical filenames as exact', async () => {
    const resolver = new FilenameTimestampResolver();
    const file = 'cam-01_20260814T134200_20260814T134300.mp4';
    assert.equal(resolver.canResolve(file), true);
    const result = await resolver.resolve(file, { timezoneOffset: '-03:00' });
    assert.equal(result.confidence, 'exact');
    assert.equal(result.source, 'filename');
    assert.equal(result.startedAt.toISOString(), '2026-08-14T16:42:00.000Z');
    assert.equal(result.endedAt.toISOString(), '2026-08-14T16:43:00.000Z');
  });

  it('does not invent 45s buckets from a folder name', () => {
    const resolver = new FilenameTimestampResolver();
    assert.equal(resolver.canResolve('C:\\\\NVR\\\\C1\\\\segment.mp4'), false);
  });

  it('uses a configured NVR regex', async () => {
    const resolver = new NvrPatternTimestampResolver();
    const source = { filenamePattern: '^(?<start>\\d{8}T\\d{6})-(?<end>\\d{8}T\\d{6})\\.mp4$' };
    const file = '20260814T134200-20260814T134300.mp4';
    assert.equal(resolver.canResolve(file, source), true);
    const result = await resolver.resolve(file, { ...source, timezoneOffset: '-03:00' });
    assert.equal(result.source, 'nvr_pattern');
    assert.equal(result.confidence, 'exact');
  });

  it('derives times from ffprobe creation_time + duration', async () => {
    const resolver = new FileMetadataTimestampResolver();
    const probe = { creationTime: '2026-08-14T16:42:00.000Z', duration: 60 };
    assert.equal(resolver.canResolve('clip.mp4', {}, probe), true);
    const result = await resolver.resolve('clip.mp4', {}, probe);
    assert.equal(result.confidence, 'derived');
    assert.equal(result.source, 'file_metadata');
    assert.equal(result.endedAt.toISOString(), '2026-08-14T16:43:00.000Z');
  });

  it('marks filesystem mtime as fallback, never exact', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cenapronta-ts-'));
    const file = path.join(dir, 'orphan.mp4');
    writeFileSync(file, 'not-a-real-video');
    const result = await new FallbackTimestampResolver().resolve(file, {}, { duration: 45 });
    assert.equal(result.confidence, 'fallback');
    assert.equal(result.source, 'filesystem_mtime');
  });

  it('prefers filename over fallback', async () => {
    const result = await resolveTimestamp(
      'cam-02_20260814T120000_20260814T120045.mp4',
      { timezoneOffset: '-03:00' },
      { duration: 99, creationTime: '1999-01-01T00:00:00.000Z' },
    );
    assert.equal(result.source, 'filename');
    assert.equal(result.confidence, 'exact');
    assert.equal(parseCompactStamp('20260814T120000').toISOString(), '2026-08-14T15:00:00.000Z');
  });
});
