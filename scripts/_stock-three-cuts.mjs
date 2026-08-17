import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const outDir = path.resolve('work/validation/stock-three');
mkdirSync(outDir, { recursive: true });
const music = path.resolve('assets/music/musica2.mp3');

const jobs = [
  {
    id: '1-casa-salao',
    title: 'Casa · salão / clientes',
    url: 'https://assets.mixkit.co/videos/42723/42723-720.mp4',
    license:
      'https://mixkit.co/free-stock-video/a-couple-having-a-romantic-dinner-at-a-restaurant-42723/',
    why: 'O que o juiz da Casa recusa: mesa e clientes, sem palco.',
    bias: 'left',
    seconds: 16,
  },
  {
    id: '2-oficio-cozinha',
    title: 'Ofício · mãos / estação',
    url: 'https://assets.mixkit.co/videos/4216/4216-1080.mp4',
    license:
      'https://mixkit.co/free-stock-video/chef-preparing-a-cake-in-a-restaurant-kitchen-4216/',
    why: 'Trabalho na bancada: o Ofício deveria ficar nisto.',
    bias: 'right',
    seconds: 16,
  },
  {
    id: '3-assinatura-prato',
    title: 'Assinatura · prato',
    url: 'https://assets.mixkit.co/videos/44001/44001-1080.mp4',
    license: 'https://mixkit.co/free-stock-video/close-up-shot-of-a-pepperoni-pizza-44001/',
    why: 'Hero do prato: o Assinatura deveria selecionar isto.',
    bias: 'center',
    seconds: 16,
  },
];

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

function nineSixteen(width, height, bias) {
  const cropW = Math.min(width, Math.round((height * 9) / 16));
  const cropH = height;
  const maxX = Math.max(0, width - cropW);
  let x = Math.round(maxX / 2);
  if (bias === 'left') x = 0;
  if (bias === 'right') x = maxX;
  return {
    x: x - (x % 2),
    y: 0,
    w: cropW - (cropW % 2),
    h: cropH - (cropH % 2),
  };
}

async function download(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 100_000) return dest;
  const result = await run('curl.exe', ['-L', '--fail', '-o', dest, url]);
  if (result.code !== 0) throw new Error(`DOWNLOAD_FAILED:${url}\n${result.stderr.slice(0, 400)}`);
  return dest;
}

const report = [];
for (const job of jobs) {
  const raw = path.join(outDir, `${job.id}.src.mp4`);
  const out = path.join(outDir, `${job.id}.mp4`);
  console.log(JSON.stringify({ step: 'download', id: job.id, url: job.url }));
  await download(job.url, raw);
  const probe = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,duration:format=duration',
    '-of',
    'json',
    raw,
  ]);
  const info = JSON.parse(probe.stdout || '{}');
  const stream = info.streams?.[0] ?? {};
  const width = Number(stream.width || 1280);
  const height = Number(stream.height || 720);
  const crop = nineSixteen(width, height, job.bias);
  const vf = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=1080:1920:flags=lanczos,fps=30,format=yuv420p`;
  const hasMusic = existsSync(music);
  const args = hasMusic
    ? [
        '-y',
        '-stream_loop',
        '4',
        '-i',
        raw,
        '-stream_loop',
        '2',
        '-i',
        music,
        '-t',
        String(job.seconds),
        '-filter_complex',
        `[0:v]${vf}[v];[1:a]volume=0.16,atrim=0:${job.seconds},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a]`,
        '-map',
        '[v]',
        '-map',
        '[a]',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '19',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        out,
      ]
    : [
        '-y',
        '-stream_loop',
        '4',
        '-i',
        raw,
        '-t',
        String(job.seconds),
        '-vf',
        vf,
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '19',
        '-movflags',
        '+faststart',
        out,
      ];
  console.log(JSON.stringify({ step: 'render', id: job.id, crop, size: `${width}x${height}` }));
  const rendered = await run('ffmpeg', args);
  if (rendered.code !== 0) {
    throw new Error(`FFMPEG_FAILED:${job.id}\n${rendered.stderr.slice(-800)}`);
  }
  const outProbe = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size:stream=width,height',
    '-of',
    'json',
    out,
  ]);
  const outInfo = JSON.parse(outProbe.stdout || '{}');
  report.push({
    ...job,
    file: out,
    crop,
    sourceSize: `${width}x${height}`,
    output: {
      duration: Number(outInfo.format?.duration ?? 0),
      width: outInfo.streams?.[0]?.width,
      height: outInfo.streams?.[0]?.height,
      bytes: Number(outInfo.format?.size ?? 0),
    },
  });
}

writeFileSync(
  path.join(outDir, 'report.json'),
  JSON.stringify({ mixkitLicense: 'Mixkit Stock Video Free License', clips: report }, null, 2),
);
console.log(
  JSON.stringify(
    {
      pass: true,
      dir: outDir,
      clips: report.map((row) => ({ id: row.id, file: row.file, why: row.why })),
    },
    null,
    2,
  ),
);
