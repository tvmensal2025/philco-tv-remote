import { Client } from 'minio';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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

async function padSource(src, dest, seconds) {
  if (existsSync(dest) && statSync(dest).size > 200_000) return dest;
  const result = await run('ffmpeg', [
    '-y',
    '-stream_loop',
    '12',
    '-i',
    src,
    '-t',
    String(seconds),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-an',
    '-movflags',
    '+faststart',
    dest,
  ]);
  if (result.code !== 0) throw new Error(`PAD_FAILED:${src}\n${result.stderr.slice(-500)}`);
  return dest;
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const now = Date.now();
const { data: liveNodes, error: liveError } = await sb
  .from('worker_nodes')
  .select('id,last_seen_at,metadata')
  .order('last_seen_at', { ascending: false })
  .limit(8);
if (liveError) throw liveError;
const live = (liveNodes ?? []).filter((node) => now - Date.parse(node.last_seen_at) < 90_000);
const vps = live.find((node) => !/rafael/i.test(String(node.metadata?.hostname ?? node.id)));
if (live.length !== 1 || !vps) {
  console.log(JSON.stringify({ pass: false, gate: 'LIVE_WORKER', live }));
  process.exit(2);
}

const minio = new Client({
  endPoint: (env.MINIO_ENDPOINT || env.MINIO_SERVER_URL || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, ''),
  port: Number(env.MINIO_PORT || 443),
  useSSL: ['true', '1', 'yes'].includes(String(env.MINIO_USE_SSL || 'true').toLowerCase()),
  accessKey: env.MINIO_ACCESS_KEY || env.MINIO_ROOT_USER,
  secretKey: env.MINIO_SECRET_KEY || env.MINIO_ROOT_PASSWORD,
});
const bucket = env.MINIO_BUCKET || 'cenapronta';
const dir = path.resolve('work/validation/stock-three');
const args = process.argv.slice(2).filter(Boolean);
const together = args.includes('together');
const only = new Set(args.filter((value) => value !== 'together'));

const jobs = [
  {
    program: 'casa',
    title: 'Mixkit salão · Casa',
    src: path.join(dir, '1-casa-salao.src.mp4'),
    position: 1,
  },
  {
    program: 'oficio',
    title: 'Mixkit cozinha · Ofício',
    src: path.join(dir, '2-oficio-cozinha.src.mp4'),
    position: 2,
  },
  {
    program: 'assinatura',
    title: 'Mixkit prato · Assinatura',
    src: path.join(dir, '3-assinatura-prato.src.mp4'),
    position: 3,
  },
].filter((job) => !only.size || only.has(job.program));

const queued = [];
const durationSeconds = 48;
const staleAt = new Date(Date.now() - 25 * 60_000).toISOString();
const sharedEndedAt = new Date();
const sharedStartedAt = new Date(sharedEndedAt.getTime() - durationSeconds * 1000);

async function uploadRecording(job, startedAt, endedAt) {
  const padded = path.join(dir, `${job.program}.padded.mp4`);
  console.log(JSON.stringify({ step: 'pad', program: job.program }));
  await padSource(job.src, padded, durationSeconds);
  const size = statSync(padded).size;
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(startedAt);
  const camera = context.cameras.find((row) => row.position === job.position);
  if (!camera) throw new Error(`CAMERA_MISSING:${job.position}`);
  const objectPath = `cenapronta/raw/${context.tenant.id}/${context.restaurant.id}/camera-${job.position}/${day}/mixkit-${job.program}-${startedAt.toISOString().replace(/[:.]/g, '-')}.mp4`;
  console.log(
    JSON.stringify({
      step: 'upload',
      program: job.program,
      position: job.position,
      size,
      objectPath,
    }),
  );
  await minio.fPutObject(bucket, objectPath, padded, {
    'Content-Type': 'video/mp4',
  });
  const { data: recording, error: recError } = await sb
    .from('recordings')
    .insert({
      tenant_id: context.tenant.id,
      restaurant_id: context.restaurant.id,
      camera_id: camera.id,
      object_key: objectPath,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      size_bytes: size,
      index_status: 'pending',
    })
    .select('id')
    .single();
  if (recError) throw recError;
  console.log(
    JSON.stringify({ step: 'uploaded', program: job.program, recordingId: recording.id }),
  );
  return recording;
}

async function insertMoment(label, startedAt, endedAt) {
  const occurredAt = new Date(startedAt.getTime() + 24_000);
  const { data: moment, error: momentError } = await sb
    .from('moments')
    .insert({
      tenant_id: context.tenant.id,
      restaurant_id: context.restaurant.id,
      type: 'manual',
      occurred_at: occurredAt.toISOString(),
      window_start: new Date(startedAt.getTime() - 2_000).toISOString(),
      window_end: new Date(endedAt.getTime() + 2_000).toISOString(),
      label,
      category: 'event',
      priority_score: 100,
      client_request_id: randomUUID(),
    })
    .select('id')
    .single();
  if (momentError) throw momentError;
  return moment;
}

async function insertReel(job, momentId, recordingId) {
  const { data: reel, error: reelError } = await sb
    .from('reels')
    .insert({
      tenant_id: context.tenant.id,
      restaurant_id: context.restaurant.id,
      moment_id: momentId,
      title: job.title,
      status: 'queued',
      progress: 0,
      metadata: {
        program: job.program,
        last_progress_at: staleAt,
        source: together ? 'mixkit-three-together' : 'mixkit-three',
        render_from_project: false,
      },
    })
    .select('id')
    .single();
  if (reelError) throw reelError;
  await sb.from('job_events').insert({
    tenant_id: context.tenant.id,
    reel_id: reel.id,
    status: 'queued',
    message: job.title,
  });
  const row = {
    program: job.program,
    reelId: reel.id,
    momentId,
    recordingId,
    watch: `http://127.0.0.1:3000/reels/${reel.id}`,
  };
  queued.push(row);
  console.log(JSON.stringify({ step: 'queued', ...row, expected_worker: vps.id }));
}

if (together) {
  const recordings = [];
  for (const job of jobs) {
    recordings.push(await uploadRecording(job, sharedStartedAt, sharedEndedAt));
  }
  const moment = await insertMoment(
    'Mixkit casa/ofício/assinatura',
    sharedStartedAt,
    sharedEndedAt,
  );
  for (const [index, job] of jobs.entries()) {
    await insertReel(job, moment.id, recordings[index].id);
  }
} else {
  for (const [index, job] of jobs.entries()) {
    const endedAt = new Date(Date.now() - index * 3_600_000);
    const startedAt = new Date(endedAt.getTime() - durationSeconds * 1000);
    const recording = await uploadRecording(job, startedAt, endedAt);
    const moment = await insertMoment(job.title, startedAt, endedAt);
    await insertReel(job, moment.id, recording.id);
  }
}

mkdirSync('work/validation', { recursive: true });
writeFileSync(
  'work/validation/stock-three-vps.json',
  JSON.stringify({ step: 'queued', expected_worker: vps.id, queued }, null, 2),
);

const deadline = Date.now() + 40 * 60_000;
const finals = new Map();
let last = '';
while (Date.now() < deadline && finals.size < queued.length) {
  const ids = queued.map((row) => row.reelId);
  const { data, error } = await sb
    .from('reels')
    .select('id,title,status,progress,error_code,error_message,duration_seconds,metadata')
    .in('id', ids);
  if (error) throw error;
  const line = (data ?? [])
    .map(
      (row) =>
        `${row.title}:${row.status}:${row.progress}:${row.metadata?.owner_worker_id ?? ''}:${row.error_code ?? ''}`,
    )
    .join(' | ');
  if (line !== last) {
    console.log(line);
    last = line;
  }
  for (const row of data ?? []) {
    if (['ready', 'failed', 'discarded'].includes(row.status)) finals.set(row.id, row);
  }
  if (finals.size < queued.length) await new Promise((resolve) => setTimeout(resolve, 8000));
}

const clips = queued.map((job) => {
  const row = finals.get(job.reelId);
  const meta = row?.metadata ?? {};
  return {
    ...job,
    status: row?.status ?? 'timeout',
    progress: row?.progress ?? null,
    duration_seconds: row?.duration_seconds ?? null,
    error_code: row?.error_code ?? null,
    error_message: row?.error_message ?? null,
    owner_worker_id: meta.owner_worker_id ?? null,
    house_cut: meta.house_cut ?? [],
    take_judge: (meta.take_judge ?? []).map((item) => ({
      decision: item.decision,
      rejectCode: item.rejectCode,
      customersOnly: item.customersOnly,
      sourceIn: item.sourceIn,
      reason: item.reason,
    })),
    cropModes: (meta.house_cut ?? []).map((take) => take.cropMode),
    join: meta.join ?? null,
  };
});
const result = {
  pass: clips.every(
    (clip) =>
      clip.status === 'ready' &&
      String(clip.owner_worker_id ?? '').startsWith(String(vps.id).split('-')[0]),
  ),
  expected_worker: vps.id,
  clips,
};
writeFileSync('work/validation/stock-three-vps.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 2);
