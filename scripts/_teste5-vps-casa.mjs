import { Client } from 'minio';
import { createClient } from '@supabase/supabase-js';
import { createReadStream, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function mvhdSeconds(buf) {
  const marker = Buffer.from('mvhd');
  let from = 0;
  while (from + 24 <= buf.length) {
    const idx = buf.indexOf(marker, from);
    if (idx < 0 || idx + 24 > buf.length) return null;
    const version = buf[idx + 4];
    if (version === 0) {
      const timescale = buf.readUInt32BE(idx + 16);
      const duration = buf.readUInt32BE(idx + 20);
      if (timescale > 0 && duration > 0) return duration / timescale;
    } else if (version === 1 && idx + 36 <= buf.length) {
      const timescale = buf.readUInt32BE(idx + 24);
      const duration = Number(buf.readBigUInt64BE(idx + 28));
      if (timescale > 0 && duration > 0) return duration / timescale;
    }
    from = idx + 4;
  }
  return null;
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const file = process.argv[2] || 'D:\\DEV\\TESTE5.mp4';
const size = statSync(file).size;
const header = readFileSync(file, { start: 0, end: Math.min(size, 4 * 1024 * 1024) - 1 });
const durationSeconds = Math.max(8, Math.min(3600, mvhdSeconds(header) ?? 24 * 60));
const endedAt = new Date();
const startedAt = new Date(endedAt.getTime() - durationSeconds * 1000);
const occurredAt = new Date(startedAt.getTime() + Math.floor(durationSeconds * 500));
const before = 120;
const after = 120;
const windowStart = new Date(occurredAt.getTime() - before * 1000);
const windowEnd = new Date(occurredAt.getTime() + after * 1000);
const day = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(startedAt);
const objectPath = `cenapronta/raw/${context.tenant.id}/${context.restaurant.id}/camera-1/${day}/${startedAt.toISOString()}.mp4`;

const minio = new Client({
  endPoint: (env.MINIO_ENDPOINT || env.MINIO_SERVER_URL || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, ''),
  port: Number(env.MINIO_PORT || 443),
  useSSL: ['true', '1', 'yes'].includes(String(env.MINIO_USE_SSL || 'true').toLowerCase()),
  accessKey: env.MINIO_ACCESS_KEY || env.MINIO_ROOT_USER,
  secretKey: env.MINIO_SECRET_KEY || env.MINIO_ROOT_PASSWORD,
});
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: liveNodes, error: liveError } = await sb
  .from('worker_nodes')
  .select('id,last_seen_at,metadata')
  .order('last_seen_at', { ascending: false })
  .limit(8);
if (liveError) throw liveError;
const now = Date.now();
const live = (liveNodes ?? []).filter((node) => now - Date.parse(node.last_seen_at) < 90_000);
const vps = live.find((node) => !/rafael/i.test(String(node.metadata?.hostname ?? node.id)));
if (live.length !== 1 || !vps) {
  console.log(JSON.stringify({ pass: false, gate: 'LIVE_WORKER', live }));
  process.exit(2);
}

console.log(
  JSON.stringify({
    step: 'upload',
    file,
    size,
    durationSeconds: Number(durationSeconds.toFixed(2)),
    objectPath,
    worker: vps.id,
  }),
);
await minio.putObject(env.MINIO_BUCKET || 'cenapronta', objectPath, createReadStream(file), size, {
  'Content-Type': 'video/mp4',
});

const cameraId = context.cameras.find((row) => row.position === 1)?.id;
const { data: recording, error: recError } = await sb
  .from('recordings')
  .insert({
    tenant_id: context.tenant.id,
    restaurant_id: context.restaurant.id,
    camera_id: cameraId,
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

const { data: moment, error: momentError } = await sb
  .from('moments')
  .insert({
    tenant_id: context.tenant.id,
    restaurant_id: context.restaurant.id,
    type: 'manual',
    occurred_at: occurredAt.toISOString(),
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    label: 'TESTE5 Bem Assados',
    category: 'event',
    priority_score: 100,
    client_request_id: randomUUID(),
  })
  .select('id')
  .single();
if (momentError) throw momentError;

const staleAt = new Date(Date.now() - 3 * 60_000).toISOString();
const { data: reel, error: reelError } = await sb
  .from('reels')
  .insert({
    tenant_id: context.tenant.id,
    restaurant_id: context.restaurant.id,
    moment_id: moment.id,
    title: 'TESTE5 Bem Assados · Casa',
    status: 'queued',
    progress: 0,
    metadata: {
      program: 'casa',
      last_progress_at: staleAt,
      source: 'teste5',
    },
  })
  .select('id')
  .single();
if (reelError) throw reelError;

await sb.from('job_events').insert({
  tenant_id: context.tenant.id,
  reel_id: reel.id,
  status: 'queued',
  message: 'Casa TESTE5',
});

const report = {
  step: 'queued',
  recording_id: recording.id,
  moment_id: moment.id,
  casa_id: reel.id,
  watch: `http://127.0.0.1:3000/reels/${reel.id}`,
  expected_worker: vps.id,
  window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
};
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/teste5-vps-casa.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const deadline = Date.now() + 20 * 60_000;
let last = '';
let finalRow = null;
while (Date.now() < deadline) {
  const { data, error } = await sb
    .from('reels')
    .select('id,status,progress,error_code,error_message,duration_seconds,updated_at,metadata')
    .eq('id', reel.id)
    .single();
  if (error) throw error;
  const line = `${data.status} ${data.progress} ${data.error_code ?? ''} ${data.metadata?.owner_worker_id ?? ''} ${data.metadata?.recovery_action ?? ''}`;
  if (line !== last) {
    console.log(line);
    last = line;
  }
  if (['ready', 'failed', 'discarded'].includes(data.status)) {
    finalRow = data;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 8000));
}

const meta = finalRow?.metadata ?? {};
const result = {
  pass:
    finalRow?.status === 'ready' &&
    Boolean(meta.house_cut) &&
    Boolean(meta.video_project) &&
    Boolean(meta.music_bed) &&
    String(meta.owner_worker_id ?? '').startsWith(String(vps.id).split('-')[0]),
  casa_id: reel.id,
  moment_id: moment.id,
  status: finalRow?.status ?? 'timeout',
  progress: finalRow?.progress ?? null,
  duration_seconds: finalRow?.duration_seconds ?? null,
  error_code: finalRow?.error_code ?? null,
  error_message: finalRow?.error_message ?? null,
  owner_worker_id: meta.owner_worker_id ?? null,
  expected_worker: vps.id,
  house_cut: Array.isArray(meta.house_cut) ? meta.house_cut.length : 0,
  video_project: Boolean(meta.video_project),
  music_bed: meta.music_bed ?? null,
  join: meta.join ?? null,
  cropMode: meta.house_cut?.[0]?.cropMode ?? null,
  yoloMs: meta.timings?.yoloMs ?? null,
  director_used: meta.director_used ?? null,
  watch: `http://127.0.0.1:3000/reels/${reel.id}`,
};
writeFileSync('work/validation/teste5-vps-casa.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 2);
