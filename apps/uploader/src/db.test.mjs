import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openUploadDb } from './db.mjs';

describe('uploaded_files sqlite', () => {
  it('survives reopen without duplicating an uploaded path', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cenapronta-db-'));
    const dbPath = path.join(dir, 'uploaded-files.sqlite');
    const first = await openUploadDb(dbPath);
    first.upsert({
      source_path: 'd:/nvr/c1/cam-01_20260814T134200_20260814T134300.mp4',
      checksum: 'abc',
      status: 'uploaded',
      object_key: 'cenapronta/raw/x.mp4',
      attempts: 1,
    });
    first.close();
    const second = await openUploadDb(dbPath);
    const row = second.getByPath('d:/nvr/c1/cam-01_20260814T134200_20260814T134300.mp4');
    assert.equal(row.status, 'uploaded');
    assert.equal(row.object_key, 'cenapronta/raw/x.mp4');
    assert.equal(second.getByChecksum('abc').source_path, row.source_path);
    second.close();
  });

  it('keeps retry state after a failed attempt', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cenapronta-db-'));
    const store = await openUploadDb(path.join(dir, 'uploaded-files.sqlite'));
    store.upsert({
      source_path: '/tmp/a.mp4',
      status: 'failed',
      attempts: 2,
      last_error: 'ECONNREFUSED',
      retry_at: Date.now() + 5000,
    });
    const row = store.getByPath('/tmp/a.mp4');
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 2);
    assert.equal(row.last_error, 'ECONNREFUSED');
    assert.ok(Number(row.retry_at) > Date.now());
    store.close();
  });
});
