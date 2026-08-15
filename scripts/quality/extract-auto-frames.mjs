import { spawn } from 'node:child_process';
import path from 'node:path';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) =>
      code === 0 ? resolve(true) : reject(new Error(stderr.slice(-800) || `${command} ${code}`)),
    );
  });
}

const input = path.resolve('work/quality/quality-first-automatic.mp4');
const duration = 12.233;
for (const pct of [5, 15, 30, 50, 70, 85, 95]) {
  const ss = Math.max(0, (duration * pct) / 100 - 0.04);
  await run('ffmpeg', [
    '-y',
    '-ss',
    ss.toFixed(3),
    '-i',
    input,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    '-pix_fmt',
    'yuvj420p',
    path.resolve('work/quality/inspect', `auto-${pct}.jpg`),
  ]);
}
console.log('ok');
