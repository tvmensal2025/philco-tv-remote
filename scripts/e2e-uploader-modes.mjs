import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

function run(command, args, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...extra });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const root = path.join('work', 'uploader-modes');
rmSync(root, { recursive: true, force: true });
const watchDir = path.join(root, 'nvr', 'C1');
const outboxDir = path.join(root, 'outbox');
const uploadedDir = path.join(root, 'uploaded');
const failedDir = path.join(root, 'failed');
mkdirSync(watchDir, { recursive: true });
mkdirSync(outboxDir, { recursive: true });
mkdirSync(uploadedDir, { recursive: true });
mkdirSync(failedDir, { recursive: true });

const sample = existsSync('test-assets/e2e/cam-01.mp4')
  ? 'test-assets/e2e/cam-01.mp4'
  : 'test-assets/e2e/reels/casa.mp4';
const watchFile = path.join(watchDir, 'cam-01_20260813T120000_20260813T120100.mp4');
copyFileSync(sample, watchFile);
const before = { size: statSync(watchFile).size, mtimeMs: statSync(watchFile).mtimeMs };

const watchConfig = {
  apiUrl: 'http://127.0.0.1:9',
  ingestKey: env.INGEST_API_KEY,
  restaurantId: context.restaurant.id,
  sourceMode: 'watch',
  camerasDir: path.join(root, 'nvr'),
  dbPath: path.resolve(root, 'watch.sqlite'),
  fileStableSeconds: 1,
  fileStableChecks: 3,
  cameras: { 'cam-01': 1 },
};
writeFileSync(path.join(root, 'watch.json'), JSON.stringify(watchConfig, null, 2));

const offline = await run('node', ['apps/uploader/src/index.mjs', '--once'], {
  env: { ...process.env, CENAPRONTA_UPLOADER_CONFIG: path.resolve(root, 'watch.json') },
});
const afterOffline = statSync(watchFile);
const offlinePass =
  existsSync(watchFile) &&
  afterOffline.size === before.size &&
  afterOffline.mtimeMs === before.mtimeMs &&
  offline.code === 0;

const restartFirst = await run('node', ['apps/uploader/src/index.mjs', '--once'], {
  env: { ...process.env, CENAPRONTA_UPLOADER_CONFIG: path.resolve(root, 'watch.json') },
});
await new Promise((resolve) => setTimeout(resolve, 4500));
const restartSecond = await run('node', ['apps/uploader/src/index.mjs', '--once'], {
  env: { ...process.env, CENAPRONTA_UPLOADER_CONFIG: path.resolve(root, 'watch.json') },
});
const restartPass =
  existsSync(watchFile) &&
  restartFirst.code === 0 &&
  restartSecond.code === 0 &&
  !/uploaded cam-01_20260813T120000/i.test(`${restartFirst.stdout}\n${restartSecond.stdout}`);

const outboxFile = path.join(outboxDir, 'cam-01_20260813T121000_20260813T121100.mp4');
copyFileSync(sample, outboxFile);
const outboxConfig = {
  apiUrl: 'http://127.0.0.1:9',
  ingestKey: env.INGEST_API_KEY,
  restaurantId: context.restaurant.id,
  sourceMode: 'outbox',
  outbox: path.resolve(outboxDir),
  uploaded: path.resolve(uploadedDir),
  failed: path.resolve(failedDir),
  dbPath: path.resolve(root, 'outbox.sqlite'),
  fileStableSeconds: 1,
  fileStableChecks: 3,
  moveOnSuccess: true,
  moveOnFailure: true,
  cameras: { 'cam-01': 1 },
};
writeFileSync(path.join(root, 'outbox.json'), JSON.stringify(outboxConfig, null, 2));
await run('node', ['apps/uploader/src/index.mjs', '--once'], {
  env: { ...process.env, CENAPRONTA_UPLOADER_CONFIG: path.resolve(root, 'outbox.json') },
});
const outboxStillThere = existsSync(outboxFile);

const report = {
  offline: {
    pass: offlinePass,
    fileRemained: existsSync(watchFile),
    log: `${offline.stdout}\n${offline.stderr}`.slice(-800),
  },
  restart: { pass: restartPass, originalRemained: existsSync(watchFile) },
  watchIntact: afterOffline.size === before.size && afterOffline.mtimeMs === before.mtimeMs,
  outbox: {
    pass: outboxStillThere,
    note: 'backend down so file stays until success; move only after successful upload',
  },
};
writeFileSync('test-assets/e2e/uploader-modes.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!offlinePass || !restartPass || !report.watchIntact) process.exit(2);
