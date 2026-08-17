import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', () => resolve({ stdout, stderr }));
  });
}

const mp4 = path.resolve('work/validation/teste5-casa/reel.mp4');
const dest = path.resolve('work/validation/teste5-casa');
mkdirSync(dest, { recursive: true });
const stamps = [6, 18, 30, 42, 54];
const rows = [];
for (const t of stamps) {
  const jpg = path.join(dest, `mid-${t}.jpg`);
  await run('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-q:v', '3', jpg]);
  const stats = await run('ffmpeg', ['-i', jpg, '-vf', 'signalstats', '-f', 'null', '-']);
  const yavg = Number(stats.stderr.match(/YAVG:([\d.]+)/)?.[1] ?? NaN);
  rows.push({ t, yavg, jpg });
}
const midVol = await run('ffmpeg', [
  '-ss',
  '25',
  '-t',
  '8',
  '-i',
  mp4,
  '-af',
  'astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.RMS_level',
  '-f',
  'null',
  '-',
]);
const rms = [...midVol.stderr.matchAll(/RMS_level=([-\d.]+)/g)].map((m) => Number(m[1])).at(-1);
console.log(JSON.stringify({ rows, rmsMid25to33: rms }, null, 2));
