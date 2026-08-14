import { mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
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
    child.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr || `${command} ${code}`)),
    );
  });
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const { reelIds, titles } = JSON.parse(readFileSync('test-assets/e2e/v2-casa.json', 'utf8'));
const outRoot = path.resolve('work/validation/frames');
mkdirSync(outRoot, { recursive: true });
const ffprobe = env.FFPROBE_PATH || 'ffprobe';
const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
const reports = [];

for (let i = 0; i < reelIds.length; i++) {
  const reelId = reelIds[i];
  const title = titles?.[i] ?? reelId.slice(0, 8);
  const slug = String(title)
    .split('·')
    .pop()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-');
  const mp4 = path.join(outRoot, `${slug || i}.mp4`);
  const media = await fetch(`http://127.0.0.1:3000/api/media/${reelId}`, {
    headers: { cookie: `reelops-tenant=${context.tenant.id}` },
  });
  if (!media.ok) {
    reports.push({
      reelId,
      title,
      mediaStatus: media.status,
      error: await media.text().then((t) => t.slice(0, 200)),
    });
    continue;
  }
  const buf = Buffer.from(await media.arrayBuffer());
  writeFileSync(mp4, buf);
  const probe = JSON.parse(
    await run(ffprobe, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      mp4,
    ]),
  );
  const video = (probe.streams ?? []).find((stream) => stream.codec_type === 'video');
  const audio = (probe.streams ?? []).find((stream) => stream.codec_type === 'audio');
  const duration = Number(probe.format?.duration) || 0;
  const size = Number(probe.format?.size) || statSync(mp4).size;
  const frameDir = path.join(outRoot, slug || String(i));
  mkdirSync(frameDir, { recursive: true });
  const percents = [10, 30, 50, 70, 90];
  const frames = [];
  for (const pct of percents) {
    const t = Math.max(0.05, duration * (pct / 100));
    const file = path.join(frameDir, `p${pct}.jpg`);
    await run(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(t.toFixed(3)),
      '-i',
      mp4,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      file,
    ]);
    const stats = existsSync(file) ? statSync(file) : null;
    let mean = null;
    try {
      const raw = await run(ffprobe, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'frame=pkt_size',
        '-of',
        'csv=p=0',
        file,
      ]);
      mean = Number(raw.trim().split(/\s+/)[0]) || stats?.size || null;
    } catch {
      mean = stats?.size ?? null;
    }
    frames.push({
      pct,
      file,
      bytes: stats?.size ?? 0,
      blackLikely: (stats?.size ?? 0) < 4000,
      signalProxyBytes: mean,
    });
  }
  reports.push({
    reelId,
    title,
    mediaStatus: media.status,
    file: mp4,
    size,
    duration,
    width: video?.width ?? null,
    height: video?.height ?? null,
    codec: video?.codec_name ?? null,
    pixFmt: video?.pix_fmt ?? null,
    fps: video?.r_frame_rate ?? video?.avg_frame_rate ?? null,
    audioCodec: audio?.codec_name ?? null,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    channels: audio?.channels ?? null,
    frames,
  });
}

writeFileSync('work/validation/outputs.json', JSON.stringify(reports, null, 2));
console.log(
  JSON.stringify(
    reports.map((row) => ({
      title: row.title,
      status: row.mediaStatus,
      res: row.width ? `${row.width}x${row.height}` : null,
      codec: row.codec,
      pix: row.pixFmt,
      fps: row.fps,
      dur: row.duration,
      size: row.size,
      audio: row.audioCodec,
      blackFrames: row.frames?.filter((frame) => frame.blackLikely).map((frame) => frame.pct) ?? [],
    })),
    null,
    2,
  ),
);
