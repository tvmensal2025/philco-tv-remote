import { createClient } from '@supabase/supabase-js';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

function run(command, args, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...extra });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} exit ${code}\n${stderr}`));
    });
  });
}

function ffprobeJson(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      file,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || `ffprobe ${code}`));
      else resolve(JSON.parse(stdout));
    });
  });
}

function summarizeProbe(probe) {
  const video = (probe.streams ?? []).find((stream) => stream.codec_type === 'video');
  const audio = (probe.streams ?? []).find((stream) => stream.codec_type === 'audio');
  return {
    duration: Number(probe.format?.duration) || 0,
    size: Number(probe.format?.size) || 0,
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    codec: video?.codec_name ?? null,
    fps: video?.r_frame_rate ?? null,
    audio: audio?.codec_name ?? null,
  };
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const watchRoot = path.resolve('work/nvr-watch');
const sources = {
  1: {
    file: 'test-assets/e2e/cam-01.mp4',
    dest: path.join(watchRoot, 'C1', 'cam-01_20260813T134200_20260813T134300.mp4'),
  },
  2: {
    file: 'test-assets/e2e/cam-02.mp4',
    dest: path.join(watchRoot, 'C2', 'cam-02_20260813T134200_20260813T134300.mp4'),
  },
  3: {
    file: 'test-assets/e2e/cam-03.mp4',
    dest: path.join(watchRoot, 'C3', 'cam-03_20260813T134200_20260813T134300.mp4'),
  },
  4: {
    file: 'test-assets/e2e/cam-04.mp4',
    dest: path.join(watchRoot, 'C4', 'cam-04_20260813T134200_20260813T134300.mp4'),
  },
};

mkdirSync(path.join(watchRoot, 'C1'), { recursive: true });
mkdirSync(path.join(watchRoot, 'C2'), { recursive: true });
mkdirSync(path.join(watchRoot, 'C3'), { recursive: true });
mkdirSync(path.join(watchRoot, 'C4'), { recursive: true });

const uploaderConfig = {
  apiUrl: 'http://127.0.0.1:3000',
  ingestKey: env.INGEST_API_KEY,
  restaurantId: context.restaurant.id,
  sourceMode: 'watch',
  camerasDir: watchRoot,
  dbPath: path.resolve('work/nvr-watch/uploaded-files.sqlite'),
  fileStableSeconds: 1,
  fileStableChecks: 3,
  timestampTimezone: '-03:00',
  cameras: { 'cam-01': 1, 'cam-02': 2, 'cam-03': 3, 'cam-04': 4 },
};
writeFileSync('apps/uploader/config.json', JSON.stringify(uploaderConfig, null, 2));

const originals = {};
for (const source of Object.values(sources)) {
  if (!existsSync(source.file)) throw new Error(`missing ${source.file}`);
  copyFileSync(source.file, source.dest);
  originals[source.dest] = {
    size: statSync(source.dest).size,
    mtimeMs: statSync(source.dest).mtimeMs,
  };
}

await run('node', ['apps/uploader/src/index.mjs', '--once'], {
  env: { ...process.env, CENAPRONTA_UPLOADER_CONFIG: path.resolve('apps/uploader/config.json') },
});

const watchIntact = Object.entries(originals).every(([file, before]) => {
  if (!existsSync(file)) return false;
  const after = statSync(file);
  return after.size === before.size && after.mtimeMs === before.mtimeMs;
});
if (!watchIntact) throw new Error('WATCH_MODE_MUTATED_ORIGINAL');

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: recordings, error: recordingError } = await sb
  .from('recordings')
  .select(
    'id,camera_id,object_key,started_at,ended_at,duration_seconds,checksum,timestamp_source,timestamp_confidence,idempotency_key,size_bytes',
  )
  .eq('restaurant_id', context.restaurant.id)
  .gte('started_at', '2026-08-13T16:41:00.000Z')
  .lt('started_at', '2026-08-13T16:44:00.000Z');
if (recordingError) throw recordingError;

const ready = await fetch('http://127.0.0.1:3000/api/ready').then((res) => res.json());
if (!ready.ready) throw new Error(`web not ready: ${JSON.stringify(ready)}`);

const momentRes = await fetch('http://127.0.0.1:3000/api/moments', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    cookie: `reelops-tenant=${context.tenant.id}`,
  },
  body: JSON.stringify({
    restaurantId: context.restaurant.id,
    occurredAt: '2026-08-13T16:42:30.000Z',
    beforeSeconds: 12,
    afterSeconds: 8,
    label: 'Núcleo watch 13:42',
    category: 'event',
  }),
});
const momentBody = await momentRes.json();
const reels = momentBody.reels ?? [];
writeFileSync(
  'test-assets/e2e/core-stabilize.json',
  JSON.stringify(
    {
      watchIntact,
      recordings,
      momentStatus: momentRes.status,
      moment: momentBody.moment ?? null,
      reelIds: reels.map((reel) => reel.id),
      titles: reels.map((reel) => reel.title),
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      watchIntact,
      recordings: (recordings ?? []).length,
      momentStatus: momentRes.status,
      momentId: momentBody.moment?.id ?? null,
      reelCount: reels.length,
      titles: reels.map((reel) => reel.title),
      error: momentBody.error ?? null,
    },
    null,
    2,
  ),
);

if (!watchIntact || (recordings ?? []).length < 4 || momentRes.status >= 400 || reels.length < 4)
  process.exit(2);
process.exit(0);
