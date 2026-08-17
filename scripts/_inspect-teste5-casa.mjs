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

const env = loadEnv();
const reelId = process.argv[2] || 'b3041836-2974-4b4e-96ba-0eb7e77b99b8';
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: reel, error } = await sb
  .from('reels')
  .select('id,status,duration_seconds,caption,output_path,thumbnail_path,metadata')
  .eq('id', reelId)
  .single();
if (error || !reel) throw error ?? new Error('reel missing');

const minio = new Client({
  endPoint: (env.MINIO_ENDPOINT || '').replace(/^https?:\/\//i, '').replace(/\/$/, ''),
  port: Number(env.MINIO_PORT || 443),
  useSSL: ['true', '1', 'yes'].includes(String(env.MINIO_USE_SSL || '').toLowerCase()),
  accessKey: env.MINIO_ACCESS_KEY || env.MINIO_ROOT_USER,
  secretKey: env.MINIO_SECRET_KEY || env.MINIO_ROOT_PASSWORD,
});
const destDir = path.resolve('work/validation/teste5-casa');
mkdirSync(destDir, { recursive: true });
const mp4 = path.join(destDir, 'reel.mp4');
if (!existsSync(mp4)) {
  await minio.fGetObject(env.MINIO_BUCKET || 'cenapronta', reel.output_path, mp4);
}

const probe = await run('ffprobe', [
  '-v',
  'error',
  '-show_entries',
  'format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,duration,nb_frames,sample_rate,channels,bit_rate',
  '-of',
  'json',
  mp4,
]);
const black = await run('ffmpeg', [
  '-i',
  mp4,
  '-vf',
  'blackdetect=d=0.25:pix_th=0.12',
  '-af',
  'silencedetect=n=-40dB:d=0.25,astats=metadata=1:reset=1',
  '-f',
  'null',
  '-',
]);
const volLast = await run('ffmpeg', [
  '-sseof',
  '-2.5',
  '-i',
  mp4,
  '-af',
  'astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.RMS_level',
  '-f',
  'null',
  '-',
]);
const volFirst = await run('ffmpeg', [
  '-t',
  '2.5',
  '-i',
  mp4,
  '-af',
  'astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.RMS_level',
  '-f',
  'null',
  '-',
]);

const duration = Number(
  JSON.parse(probe.stdout || '{}').format?.duration ?? reel.duration_seconds ?? 19,
);
const stamps = [0.4, 2, 5, 8, 11, 14, 16.5, Math.max(0.2, duration - 0.4)];
const frames = [];
for (const t of stamps) {
  const jpg = path.join(destDir, `t-${String(t).replace('.', 'p')}.jpg`);
  await run('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-q:v', '3', jpg]);
  frames.push({ t, jpg: existsSync(jpg) });
}

function parseBlack(stderr) {
  return [
    ...stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g),
  ].map((m) => ({ start: Number(m[1]), end: Number(m[2]), duration: Number(m[3]) }));
}
function parseSilence(stderr) {
  const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((start, i) => ({ start, end: ends[i] ?? null }));
}
function parseRms(stderr) {
  const hits = [...stderr.matchAll(/RMS_level=([-\d.]+)/g)].map((m) => Number(m[1]));
  return hits.at(-1) ?? null;
}

const meta = reel.metadata ?? {};
const report = {
  reelId,
  duration_db: reel.duration_seconds,
  output_path: reel.output_path,
  probe: JSON.parse(probe.stdout || '{}'),
  house_cut: meta.house_cut ?? [],
  join: meta.join,
  music: meta.music_bed,
  sourceAudio: meta.sourceAudio,
  fade: {
    lastSceneFadeOut: meta.house_cut?.at?.(-1)?.fadeOut ?? meta.video_edit_decision ?? null,
  },
  scenes: (meta.video_edit_decision?.timeline ?? meta.video_edit_decision?.scenes ?? []).slice?.(
    0,
    12,
  ),
  black: parseBlack(black.stderr),
  silence: parseSilence(black.stderr),
  rmsFirst2s: parseRms(volFirst.stderr),
  rmsLast2s: parseRms(volLast.stderr),
  frames,
  timings: meta.timings ?? {},
  director: meta.director_used,
  cropModes: (meta.house_cut ?? []).map((t) => ({
    id: t.id,
    duration: t.duration,
    cropMode: t.cropMode,
    transition: t.transition,
  })),
};
writeFileSync(path.join(destDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
