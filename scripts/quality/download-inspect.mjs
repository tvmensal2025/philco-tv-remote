import { Client } from 'minio';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(true) : reject(new Error(stderr || `${command} ${code}`)),
    );
  });
}

const env = loadEnv();
const minio = new Client({
  endPoint: env.MINIO_ENDPOINT,
  port: Number(env.MINIO_PORT || 9000),
  useSSL: ['true', '1', 'yes'].includes(String(env.MINIO_USE_SSL || '').toLowerCase()),
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});
const bucket = env.MINIO_BUCKET || 'cenapronta';
const root = path.resolve('work/quality');
mkdirSync(path.join(root, 'inspect'), { recursive: true });
mkdirSync(path.join(root, 'baseline'), { recursive: true });

async function download(key, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  await minio.fGetObject(bucket, key, dest);
  return dest;
}

const recordings = [
  [
    'C1',
    'cenapronta/raw/6399a79c-6b2d-4672-9132-3870bf5e0fbc/dbd3c84b-aa9d-40df-8245-259d27a83292/camera-1/2026-08-13/2026-08-13T16:42:00.000Z.mp4',
  ],
  [
    'C2',
    'cenapronta/raw/6399a79c-6b2d-4672-9132-3870bf5e0fbc/dbd3c84b-aa9d-40df-8245-259d27a83292/camera-2/2026-08-13/2026-08-13T16:42:00.000Z.mp4',
  ],
  [
    'C3',
    'cenapronta/raw/6399a79c-6b2d-4672-9132-3870bf5e0fbc/dbd3c84b-aa9d-40df-8245-259d27a83292/camera-3/2026-08-13/2026-08-13T16:42:00.000Z.mp4',
  ],
  [
    'C4',
    'cenapronta/raw/6399a79c-6b2d-4672-9132-3870bf5e0fbc/dbd3c84b-aa9d-40df-8245-259d27a83292/camera-4/2026-08-13/2026-08-13T16:42:00.000Z.mp4',
  ],
];

const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
const percents = [10, 30, 50, 70, 90];
const downloaded = [];
for (const [label, key] of recordings) {
  const dest = path.join(root, 'source', `${label}.mp4`);
  await download(key, dest);
  for (const pct of percents) {
    const t = ((45 * pct) / 100).toFixed(2);
    const jpg = path.join(root, 'inspect', `${label}-${pct}.jpg`);
    await run(ffmpeg, [
      '-y',
      '-ss',
      t,
      '-i',
      dest,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-pix_fmt',
      'yuvj420p',
      jpg,
    ]);
  }
  downloaded.push({ label, dest, exists: existsSync(dest) });
}

const baselineKey =
  'cenapronta/people/6399a79c-6b2d-4672-9132-3870bf5e0fbc/dbd3c84b-aa9d-40df-8245-259d27a83292/2026-08-13/reels/bcf8499f-6f30-41ab-8199-ead206c23b67/reel.mp4';
const baselinePath = path.join(root, 'baseline', 'baseline-casa.mp4');
await download(baselineKey, baselinePath);

const yoloUrl = env.YOLO_URL || 'https://cenapronta-yolo.d9v63q.easypanel.host';
let yolo = { ok: false };
try {
  const health = await fetch(`${yoloUrl.replace(/\/$/, '')}/health`, {
    signal: AbortSignal.timeout(4000),
  });
  yolo = { ok: health.ok, status: health.status, body: await health.json().catch(() => null) };
} catch (error) {
  yolo = { ok: false, error: error instanceof Error ? error.message : String(error) };
}

const report = {
  moment_id: '89a35d82-7a28-40fb-b746-9ab109bbaa09',
  window: '2026-08-13T16:42:05Z .. 16:42:55Z',
  recordings: downloaded,
  baseline: {
    reelId: 'bcf8499f-6f30-41ab-8199-ead206c23b67',
    path: baselinePath,
    exists: existsSync(baselinePath),
  },
  yolo,
};
writeFileSync(path.join(root, 'inspect-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
