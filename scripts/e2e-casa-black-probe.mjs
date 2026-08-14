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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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

const env = loadEnv();
const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
const mp4 = path.resolve('work/validation/frames/casa.mp4');
const dir = path.resolve('work/validation/frames/casa-black');
mkdirSync(dir, { recursive: true });
const times = ['14.0', '14.8', '15.2', '15.6', '16.2', '20.8'];
const rows = [];
for (const t of times) {
  const file = path.join(dir, `t${t.replace('.', '-')}.jpg`);
  await run(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    t,
    '-i',
    mp4,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    file,
  ]);
  const bytes = statSync(file).size;
  rows.push({ t, file, bytes, blackLikely: bytes < 20000 });
}
writeFileSync('work/validation/casa-black.json', JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 2));
