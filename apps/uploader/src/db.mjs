import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJsModule from 'sql.js';

const require = createRequire(import.meta.url);
const initSqlJs = initSqlJsModule.default ?? initSqlJsModule;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS uploaded_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL UNIQUE,
  file_size INTEGER,
  modified_at TEXT,
  checksum TEXT,
  camera_id TEXT,
  started_at TEXT,
  ended_at TEXT,
  object_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  uploaded_at TEXT,
  created_at TEXT NOT NULL,
  retry_at INTEGER
);
CREATE INDEX IF NOT EXISTS uploaded_files_checksum_idx ON uploaded_files(checksum);
CREATE INDEX IF NOT EXISTS uploaded_files_status_idx ON uploaded_files(status);
`;

export async function openUploadDb(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  db.run(SCHEMA);

  function persist() {
    writeFileSync(dbPath, Buffer.from(db.export()));
  }

  persist();

  function getByPath(sourcePath) {
    const stmt = db.prepare('SELECT * FROM uploaded_files WHERE source_path = ?');
    stmt.bind([sourcePath]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  }

  function getByChecksum(checksum) {
    if (!checksum) return null;
    const stmt = db.prepare(
      "SELECT * FROM uploaded_files WHERE checksum = ? AND status = 'uploaded' ORDER BY uploaded_at DESC LIMIT 1",
    );
    stmt.bind([checksum]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  }

  function upsert(row) {
    const existing = getByPath(row.source_path);
    const now = new Date().toISOString();
    if (!existing) {
      db.run(
        `INSERT INTO uploaded_files (
          source_path, file_size, modified_at, checksum, camera_id, started_at, ended_at,
          object_key, status, attempts, last_error, uploaded_at, created_at, retry_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.source_path,
          row.file_size ?? null,
          row.modified_at ?? null,
          row.checksum ?? null,
          row.camera_id ?? null,
          row.started_at ?? null,
          row.ended_at ?? null,
          row.object_key ?? null,
          row.status ?? 'pending',
          row.attempts ?? 0,
          row.last_error ?? null,
          row.uploaded_at ?? null,
          row.created_at ?? now,
          row.retry_at ?? null,
        ],
      );
    } else {
      db.run(
        `UPDATE uploaded_files SET
          file_size = ?, modified_at = ?, checksum = ?, camera_id = ?, started_at = ?, ended_at = ?,
          object_key = ?, status = ?, attempts = ?, last_error = ?, uploaded_at = ?, retry_at = ?
        WHERE source_path = ?`,
        [
          row.file_size ?? existing.file_size,
          row.modified_at ?? existing.modified_at,
          row.checksum ?? existing.checksum,
          row.camera_id ?? existing.camera_id,
          row.started_at ?? existing.started_at,
          row.ended_at ?? existing.ended_at,
          row.object_key ?? existing.object_key,
          row.status ?? existing.status,
          row.attempts ?? existing.attempts,
          row.last_error === undefined ? existing.last_error : row.last_error,
          row.uploaded_at ?? existing.uploaded_at,
          row.retry_at === undefined ? existing.retry_at : row.retry_at,
          row.source_path,
        ],
      );
    }
    persist();
    return getByPath(row.source_path);
  }

  function close() {
    persist();
    db.close();
  }

  return { db, persist, getByPath, getByChecksum, upsert, close };
}
