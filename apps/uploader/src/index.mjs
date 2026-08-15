import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  watch,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openUploadDb } from './db.mjs';
import { assertCompleteMedia, probeVideo } from './probe.mjs';
import { createRtspRecorder } from './rtsp.mjs';
import { createSofiaAgent } from './sofia.mjs';
import { resolveTimestamp } from './timestamps.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CENAPRONTA_UPLOADER_CONFIG || path.join(root, '..', 'config.json');

if (!existsSync(configPath)) {
  console.error(`Crie ${configPath} a partir de config.example.json`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const defaultMode = config.sourceMode === 'outbox' ? 'outbox' : 'watch';
const outbox = config.outbox;
const dbPath = config.dbPath || path.join(path.dirname(configPath), 'uploaded-files.sqlite');
let camerasRoot =
  config.camerasDir ||
  (outbox ? path.join(outbox, '..', 'cameras') : path.join(path.dirname(dbPath), 'cameras'));
const uploadedDir =
  config.uploaded ||
  (outbox ? path.join(outbox, '..', 'uploaded') : path.join(root, '..', 'uploaded'));
const failedDir =
  config.failed || (outbox ? path.join(outbox, '..', 'failed') : path.join(root, '..', 'failed'));
const stableSeconds = Number(
  process.env.FILE_STABLE_SECONDS ?? config.fileStableSeconds ?? config.stableMs / 1000 ?? 3,
);
const stableChecks = Number(process.env.FILE_STABLE_CHECKS ?? config.fileStableChecks ?? 3);
const stableMs = Math.max(500, Math.round(stableSeconds * 1000));
const apiUrl = String(config.apiUrl || '').replace(/\/$/, '');
const ingestKey = config.ingestKey;
const restaurantId = config.restaurantId;
const cameras = config.cameras ?? { 'cam-01': 1, 'cam-02': 2, 'cam-03': 3, 'cam-04': 4 };
const timezoneOffset = config.timestampTimezone ?? '-03:00';
const moveOnSuccess = config.moveOnSuccess !== false;
const moveOnFailure = config.moveOnFailure !== false;
const rtspSegmentSeconds = Math.max(
  15,
  Math.min(300, Number(config.rtspSegmentSeconds ?? process.env.NVR_SEGMENT_SECONDS ?? 60)),
);

if (!apiUrl || !ingestKey || !restaurantId) {
  console.error('config.json precisa de apiUrl, ingestKey e restaurantId');
  process.exit(1);
}

function cameraDirs() {
  if (!camerasRoot || !existsSync(camerasRoot)) return [];
  return readdirSync(camerasRoot)
    .filter((name) => /^c\d+$/i.test(name))
    .map((name) => path.join(camerasRoot, name));
}

function configuredSources() {
  const sources = [];
  if (Array.isArray(config.sources)) {
    for (const source of config.sources) {
      if (!source?.path) continue;
      sources.push({
        camera: source.camera,
        path: source.path,
        mode: source.mode === 'outbox' ? 'outbox' : source.mode === 'watch' ? 'watch' : defaultMode,
        filenamePattern: source.filenamePattern,
        position: source.position ?? cameras[source.camera],
        timezoneOffset: source.timezoneOffset ?? timezoneOffset,
      });
    }
  }
  if (outbox) {
    sources.push({
      camera: 'outbox',
      path: outbox,
      mode: 'outbox',
      position: null,
      timezoneOffset,
    });
  }
  for (const dir of cameraDirs()) {
    const folder = path.basename(dir);
    const position = Number(folder.replace(/^c/i, ''));
    sources.push({
      camera: `cam-${String(position).padStart(2, '0')}`,
      path: dir,
      mode: 'watch',
      position,
      timezoneOffset,
    });
  }
  return sources
    .filter((source) => source.path)
    .filter((source, index, all) => {
      const key = path.resolve(source.path).replaceAll('\\', '/').toLowerCase();
      return (
        all.findIndex(
          (item) => path.resolve(item.path).replaceAll('\\', '/').toLowerCase() === key,
        ) === index
      );
    });
}

for (const source of configuredSources()) mkdirSync(source.path, { recursive: true });
mkdirSync(camerasRoot, { recursive: true });
if (defaultMode === 'outbox' || outbox) {
  mkdirSync(uploadedDir, { recursive: true });
  mkdirSync(failedDir, { recursive: true });
}

const store = await openUploadDb(dbPath);
const rtspRecorders = new Map();

function isRtspOrigin(source) {
  return source?.origin === 'rtsp' || rtspRecorders.has(Number(source?.position));
}

function dropLocalCopy(file, source) {
  if (!isRtspOrigin(source)) return;
  try {
    unlinkSync(file);
  } catch {
    /* already gone */
  }
}

function normalizePath(file) {
  return path.resolve(file).replaceAll('\\', '/').toLowerCase();
}

function checksum(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitStable(file) {
  let last = -1;
  let seen = 0;
  const needed = Math.max(2, stableChecks);
  while (seen < needed) {
    await sleep(stableMs);
    if (!existsSync(file)) return false;
    const size = statSync(file).size;
    if (size > 0 && size === last) seen += 1;
    else {
      seen = 0;
      last = size;
    }
  }
  return true;
}

function cameraPosition(file, source, resolved) {
  const name = path.basename(file);
  const prefix = name.split('_')[0];
  return (
    cameras[prefix] ?? cameras[source?.camera] ?? source?.position ?? resolved?.position ?? null
  );
}

function idempotencyKey(cameraId, digest, startedAt, endedAt) {
  return createHash('sha256').update(`${cameraId}:${digest}:${startedAt}:${endedAt}`).digest('hex');
}

async function uploadFile(file, source, digest, resolved, size) {
  const mapped = cameraPosition(file, source, resolved);
  if (!mapped)
    throw new Error(
      'Câmera não identificada. Configure sources[].camera ou coloque o arquivo em C1–C4.',
    );
  const authorization = { authorization: `Bearer ${ingestKey}` };
  const presign = await fetch(`${apiUrl}/api/ingest/presign`, {
    method: 'POST',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      restaurantId,
      cameraPosition: Number(mapped),
      capturedAt: resolved.startedAt.toISOString(),
      contentType: 'video/mp4',
    }),
  });
  const ticket = await presign.json();
  if (!presign.ok) throw new Error(ticket.error || 'presign failed');
  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'video/mp4', 'content-length': String(size) },
    body: createReadStream(file),
    duplex: 'half',
  });
  if (!put.ok) throw new Error(`MinIO PUT ${put.status}`);
  const complete = await fetch(ticket.completeUrl, {
    method: 'POST',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      cameraId: ticket.cameraId,
      objectPath: ticket.objectPath,
      capturedAt: resolved.startedAt.toISOString(),
      endedAt: resolved.endedAt.toISOString(),
      durationSeconds: Math.max(
        1,
        (resolved.endedAt.getTime() - resolved.startedAt.getTime()) / 1000,
      ),
      expectedBytes: size,
      checksum: digest,
      timestampSource: resolved.source,
      timestampConfidence: resolved.confidence,
      idempotencyKey: idempotencyKey(
        ticket.cameraId,
        digest,
        resolved.startedAt.toISOString(),
        resolved.endedAt.toISOString(),
      ),
    }),
  });
  const confirmation = await complete.json();
  if (!complete.ok) throw new Error(confirmation.error || 'complete failed');
  return {
    objectPath: ticket.objectPath,
    cameraId: ticket.cameraId,
    recordingId: confirmation.recordingId,
  };
}

function maybeMove(file, destDir, source) {
  if (source.mode !== 'outbox') return;
  mkdirSync(destDir, { recursive: true });
  const name = `${path.basename(source.path)}-${path.basename(file)}`;
  renameSync(file, path.join(destDir, name));
}

async function processFile(file, source) {
  const key = normalizePath(file);
  const existing = store.getByPath(key);
  if (existing?.status === 'uploaded') {
    dropLocalCopy(file, source);
    return;
  }
  if (existing?.status === 'failed' && existing.retry_at && Date.now() < Number(existing.retry_at))
    return;
  if (!(await waitStable(file))) return;

  const stats = statSync(file);
  let probe;
  try {
    probe = assertCompleteMedia(await probeVideo(file));
  } catch (error) {
    const attempts = Number(existing?.attempts ?? 0) + 1;
    const delay = Math.min(15 * 60_000, 2000 * 2 ** Math.min(attempts, 8));
    store.upsert({
      source_path: key,
      file_size: stats.size,
      modified_at: stats.mtime.toISOString(),
      status: 'failed',
      attempts,
      last_error: error instanceof Error ? error.message : String(error),
      retry_at: Date.now() + delay,
      created_at: existing?.created_at,
    });
    console.error(
      `incomplete ${path.basename(file)}: ${error instanceof Error ? error.message : error}; retry in ${Math.round(delay / 1000)}s`,
    );
    return;
  }

  const digest = await checksum(file);
  const already = store.getByChecksum(digest);
  if (already?.status === 'uploaded') {
    store.upsert({
      source_path: key,
      file_size: stats.size,
      modified_at: stats.mtime.toISOString(),
      checksum: digest,
      camera_id: already.camera_id,
      started_at: already.started_at,
      ended_at: already.ended_at,
      object_key: already.object_key,
      status: 'uploaded',
      attempts: Number(existing?.attempts ?? 0),
      last_error: null,
      uploaded_at: already.uploaded_at ?? new Date().toISOString(),
      retry_at: null,
      created_at: existing?.created_at,
    });
    dropLocalCopy(file, source);
    return;
  }

  const resolved = await resolveTimestamp(file, source, probe);
  const attempts = Number(existing?.attempts ?? 0) + 1;
  store.upsert({
    source_path: key,
    file_size: stats.size,
    modified_at: stats.mtime.toISOString(),
    checksum: digest,
    started_at: resolved.startedAt.toISOString(),
    ended_at: resolved.endedAt.toISOString(),
    status: 'uploading',
    attempts,
    last_error: null,
    created_at: existing?.created_at,
  });

  try {
    const uploaded = await uploadFile(file, source, digest, resolved, stats.size);
    store.upsert({
      source_path: key,
      file_size: stats.size,
      modified_at: stats.mtime.toISOString(),
      checksum: digest,
      camera_id: uploaded.cameraId,
      started_at: resolved.startedAt.toISOString(),
      ended_at: resolved.endedAt.toISOString(),
      object_key: uploaded.objectPath,
      status: 'uploaded',
      attempts,
      last_error: null,
      uploaded_at: new Date().toISOString(),
      retry_at: null,
    });
    if (isRtspOrigin(source)) dropLocalCopy(file, source);
    else if (source.mode === 'outbox' && moveOnSuccess) maybeMove(file, uploadedDir, source);
    console.log(
      JSON.stringify({
        event: 'upload',
        camera_id: uploaded.cameraId,
        recording_id: uploaded.recordingId,
        object_key: uploaded.objectPath,
        timestamp_source: resolved.source,
        timestamp_confidence: resolved.confidence,
        mode: source.mode,
      }),
    );
  } catch (error) {
    const delay = Math.min(15 * 60_000, 2000 * 2 ** Math.min(attempts, 8));
    const message = error instanceof Error ? error.message : String(error);
    store.upsert({
      source_path: key,
      file_size: stats.size,
      modified_at: stats.mtime.toISOString(),
      checksum: digest,
      started_at: resolved.startedAt.toISOString(),
      ended_at: resolved.endedAt.toISOString(),
      status: 'failed',
      attempts,
      last_error: message,
      retry_at: Date.now() + delay,
    });
    console.error(
      JSON.stringify({
        event: 'upload_failed',
        file: path.basename(file),
        error: message,
        retry_in_s: Math.round(delay / 1000),
        mode: source.mode,
      }),
    );
    if (source.mode === 'outbox' && moveOnFailure && attempts >= 12)
      maybeMove(file, failedDir, source);
  }
}

async function scan() {
  for (const source of configuredSources()) {
    if (!existsSync(source.path)) continue;
    for (const name of readdirSync(source.path)) {
      if (!name.toLowerCase().endsWith('.mp4')) continue;
      await processFile(path.join(source.path, name), source);
    }
  }
}

const sources = configuredSources();
console.log(
  JSON.stringify({
    event: 'uploader_start',
    mode: defaultMode,
    db: dbPath,
    sources: sources.map((source) => ({
      mode: source.mode,
      camera: source.camera,
      path: source.path,
    })),
  }),
);
await scan();

const watchers = [];
let scanTimer;
let rtspTimer;
let sofiaTimer;
let shuttingDown = false;

function localRtspSources() {
  if (!Array.isArray(config.rtsp)) return [];
  return config.rtsp
    .filter((source) => source?.url && source?.position)
    .map((source) => ({
      position: Number(source.position),
      url: String(source.url),
      transport: source.transport === 'udp' ? 'udp' : 'tcp',
    }));
}

async function fetchRemoteCameras() {
  try {
    const response = await fetch(`${apiUrl}/api/ingest/sources?restaurantId=${restaurantId}`, {
      headers: { authorization: `Bearer ${ingestKey}` },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.cameras ?? [];
  } catch {
    return [];
  }
}

function applyFolderRoot(folderPath) {
  if (!folderPath) return;
  camerasRoot = folderPath;
  mkdirSync(camerasRoot, { recursive: true });
  for (let position = 1; position <= 4; position += 1) {
    const dir = path.join(camerasRoot, `C${position}`);
    mkdirSync(dir, { recursive: true });
    watchDirectory(dir);
  }
}

function rtspOutputDir(position) {
  return path.join(camerasRoot, `C${position}`);
}

async function syncRtsp() {
  if (shuttingDown) return;
  const remote = await fetchRemoteCameras();
  const folder = remote.find((camera) => camera.ingestMode === 'folder' && camera.folderPath);
  if (folder?.folderPath) applyFolderRoot(String(folder.folderPath));
  const byPosition = new Map();
  for (const source of localRtspSources()) byPosition.set(source.position, source);
  for (const camera of remote) {
    if (camera.ingestMode !== 'rtsp' || !camera.rtspUrl) continue;
    byPosition.set(Number(camera.position), {
      position: Number(camera.position),
      url: String(camera.rtspUrl),
      transport: camera.rtspTransport === 'udp' ? 'udp' : 'tcp',
    });
  }
  const live = new Set(byPosition.keys());
  for (const source of byPosition.values()) {
    const outputDir = rtspOutputDir(source.position);
    mkdirSync(outputDir, { recursive: true });
    watchDirectory(outputDir);
    const recorder = createRtspRecorder({
      url: source.url,
      position: source.position,
      outputDir,
      segmentSeconds: rtspSegmentSeconds,
      timezoneOffset,
      transport: source.transport,
      log: (event) => console.log(JSON.stringify(event)),
    });
    const existing = rtspRecorders.get(source.position);
    if (existing?.key === recorder.key) continue;
    if (existing) await existing.stop();
    rtspRecorders.set(source.position, recorder);
    recorder.start();
    console.log(JSON.stringify({ event: 'rtsp_start', position: source.position }));
  }
  for (const [position, recorder] of rtspRecorders) {
    if (live.has(position)) continue;
    await recorder.stop();
    rtspRecorders.delete(position);
    console.log(JSON.stringify({ event: 'rtsp_stop', position }));
  }
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: 'uploader_shutdown', reason }));
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      /* already closed */
    }
  }
  if (scanTimer) clearInterval(scanTimer);
  if (rtspTimer) clearInterval(rtspTimer);
  if (sofiaTimer) clearInterval(sofiaTimer);
  for (const recorder of rtspRecorders.values()) await recorder.stop();
  rtspRecorders.clear();
  store.close();
  await sleep(80);
}

if (process.argv.includes('--once')) {
  await shutdown('--once');
  process.exit(0);
}

const watched = new Set();
function watchDirectory(dir) {
  if (shuttingDown || watched.has(dir) || !existsSync(dir)) return;
  watched.add(dir);
  watchers.push(
    watch(dir, { persistent: true }, () => {
      if (!shuttingDown) void scan();
    }),
  );
}
for (const source of sources) watchDirectory(source.path);
scanTimer = setInterval(() => {
  if (!shuttingDown) void scan();
}, 15_000);
if (!process.argv.includes('--once')) {
  const sofia = createSofiaAgent({
    apiUrl,
    ingestKey,
    restaurantId,
    getCamerasRoot: () => camerasRoot,
    setCamerasRoot: (next) => {
      camerasRoot = next;
      mkdirSync(camerasRoot, { recursive: true });
      for (let position = 1; position <= 4; position += 1) {
        const dir = path.join(camerasRoot, `C${position}`);
        mkdirSync(dir, { recursive: true });
        watchDirectory(dir);
      }
    },
    log: (event) => console.log(JSON.stringify(event)),
  });
  await syncRtsp();
  await sofia.tick();
  rtspTimer = setInterval(() => {
    if (!shuttingDown) void syncRtsp();
  }, 30_000);
  sofiaTimer = setInterval(() => {
    if (!shuttingDown) void sofia.tick();
  }, 4_000);
}
process.on('SIGINT', () => {
  void shutdown('SIGINT').then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM').then(() => process.exit(0));
});
