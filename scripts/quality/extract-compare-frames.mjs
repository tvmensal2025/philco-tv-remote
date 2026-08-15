import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(true) : reject(new Error(stderr.slice(-1500) || `${command} ${code}`)),
    );
  });
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
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
      else resolve(Number.parseFloat(stdout.trim()));
    });
  });
}

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const root = path.resolve('work/quality');
mkdirSync(path.join(root, 'inspect'), { recursive: true });

const percents = [5, 15, 30, 50, 70, 85, 95];
const files = [
  { slug: 'qf', file: path.join(root, 'quality-first.mp4') },
  { slug: 'baseline', file: path.join(root, 'baseline', 'baseline-casa.mp4') },
];

for (const { slug, file } of files) {
  const duration = await probeDuration(file);
  for (const pct of percents) {
    const ss = Math.max(0, (duration * pct) / 100 - 0.04);
    await run(ffmpeg, [
      '-y',
      '-ss',
      ss.toFixed(3),
      '-i',
      file,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-pix_fmt',
      'yuvj420p',
      path.join(root, 'inspect', `${slug}-${pct}.jpg`),
    ]);
  }
}

for (const take of ['01-hook-fire', '02-seafood', '03-tandoor', '04-wok', '05-bread']) {
  const input = path.join(root, 'takes', `${take}.mp4`);
  await run(ffmpeg, [
    '-y',
    '-ss',
    '0.4',
    '-i',
    input,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    '-pix_fmt',
    'yuvj420p',
    path.join(root, 'inspect', `take-${take}.jpg`),
  ]);
}

console.log('ok');
