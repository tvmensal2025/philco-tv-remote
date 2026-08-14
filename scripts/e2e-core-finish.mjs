import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(null) : reject(new Error(stderr || `${command} ${code}`)),
    );
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
    fps: video?.avg_frame_rate ?? video?.r_frame_rate ?? null,
    audio: audio?.codec_name ?? null,
    vertical: Number(video?.height) > Number(video?.width),
  };
}

const env = loadEnv();
const { reelIds, moment } = JSON.parse(readFileSync('test-assets/e2e/core-stabilize.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const cookie = `reelops-tenant=${JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8')).tenant.id}`;
const deadline = Date.now() + 20 * 60_000;
const last = {};
let rows = [];

while (Date.now() < deadline) {
  const { data, error } = await sb
    .from('reels')
    .select(
      'id,title,status,progress,error_code,error_message,output_path,thumbnail_path,score,metadata,duration_seconds',
    )
    .in('id', reelIds);
  if (error) throw error;
  rows = data ?? [];
  for (const reel of rows) {
    const program = reel.metadata?.program ?? '?';
    const line = `${reel.status} ${reel.progress} ${program} ${reel.error_code ?? ''} ${reel.error_message ?? ''}`;
    if (last[reel.id] !== line) {
      console.log(`${reel.id.slice(0, 8)} ${reel.title} ${line}`);
      last[reel.id] = line;
    }
  }
  if (
    rows.length === reelIds.length &&
    rows.every((reel) => ['ready', 'failed', 'discarded'].includes(reel.status))
  )
    break;
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

const failed = rows.filter((reel) => reel.status !== 'ready');
if (failed.length) {
  writeFileSync('test-assets/e2e/core-stabilize-result.json', JSON.stringify(rows, null, 2));
  console.error(
    JSON.stringify(
      {
        failed: failed.map((reel) => ({
          id: reel.id,
          status: reel.status,
          error: reel.error_message,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const outDir = 'test-assets/e2e/core-reels';
mkdirSync(outDir, { recursive: true });
const probes = [];
for (const reel of rows) {
  const dest = path.join(outDir, `${reel.metadata?.program ?? reel.id}.mp4`);
  const res = await fetch(`http://127.0.0.1:3000/api/media/${reel.id}?download=1`, {
    headers: { cookie },
  });
  if (!res.ok) throw new Error(`download ${reel.id} ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  const probe = summarizeProbe(await ffprobeJson(dest));
  const frame = path.join(outDir, `${reel.metadata?.program ?? reel.id}.jpg`);
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    '1',
    '-i',
    dest,
    '-frames:v',
    '1',
    frame,
  ]);
  probes.push({
    id: reel.id,
    program: reel.metadata?.program,
    title: reel.title,
    provider: reel.metadata?.provider,
    model: reel.metadata?.model,
    scenes: reel.metadata?.scenes,
    framesByCamera: reel.metadata?.frames_by_camera,
    framesAnalyzed: reel.metadata?.frames_analyzed,
    analysisResolution: reel.metadata?.analysis_resolution,
    visionMs: reel.metadata?.timings?.geminiMs,
    output_path: reel.output_path,
    thumbnail_path: reel.thumbnail_path,
    probe,
    frameBytes: statSync(frame).size,
  });
}

const casa = rows.find((reel) => reel.metadata?.program === 'casa');
const oficio = rows.find((reel) => reel.metadata?.program === 'oficio');
const pulso = rows.find((reel) => reel.metadata?.program === 'pulso');

const approve = await fetch(`http://127.0.0.1:3000/api/reels/${casa.id}/action`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ action: 'approve' }),
});
const discard = await fetch(`http://127.0.0.1:3000/api/reels/${oficio.id}/action`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ action: 'discard' }),
});
await sb
  .from('reels')
  .update({ status: 'failed', error_code: 'E2E_RETRY', error_message: 'controlled failure' })
  .eq('id', pulso.id);
const retry = await fetch(`http://127.0.0.1:3000/api/reels/${pulso.id}/action`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ action: 'retry' }),
});

const { data: after } = await sb
  .from('reels')
  .select('id,status,metadata')
  .in('id', [casa.id, oficio.id, pulso.id]);
const report = {
  momentId: moment?.id ?? null,
  probes,
  distinctPrograms: [...new Set(probes.map((item) => JSON.stringify(item.scenes)))].length,
  heuristicUsed: probes.some((item) => item.provider === 'heuristic'),
  approve: { status: approve.status, body: await approve.json() },
  discard: { status: discard.status, body: await discard.json() },
  retry: { status: retry.status, body: await retry.json() },
  after,
};
writeFileSync('test-assets/e2e/core-stabilize-result.json', JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      programs: probes.map((item) => ({
        program: item.program,
        provider: item.provider,
        probe: item.probe,
        frameBytes: item.frameBytes,
      })),
      distinctPrograms: report.distinctPrograms,
      heuristicUsed: report.heuristicUsed,
      approve: report.approve.status,
      discard: report.discard.status,
      retry: report.retry.status,
      after: (after ?? []).map((row) => ({
        id: row.id.slice(0, 8),
        status: row.status,
        program: row.metadata?.program,
      })),
    },
    null,
    2,
  ),
);

if (report.heuristicUsed) process.exit(4);
if (
  probes.some(
    (item) =>
      !item.probe.vertical ||
      item.probe.width !== 1080 ||
      item.probe.height !== 1920 ||
      item.frameBytes < 2000,
  )
)
  process.exit(5);
if (approve.status >= 400 || discard.status >= 400 || retry.status >= 400) process.exit(6);
process.exit(0);
