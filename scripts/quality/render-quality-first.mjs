import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
      code === 0 ? resolve(true) : reject(new Error(stderr.slice(-2000) || `${command} ${code}`)),
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
const srcC1 = path.join(root, 'source', 'C1.mp4');
const takesDir = path.join(root, 'takes-c1');
mkdirSync(takesDir, { recursive: true });
mkdirSync(path.join(root, 'inspect'), { recursive: true });

const rejected = path.join(root, 'quality-first-v1-rejected.mp4');
try {
  copyFileSync(path.join(root, 'quality-first.mp4'), rejected);
} catch {
  /* first render */
}

const takes = [
  {
    name: '01-hook-bread',
    ss: 2.8,
    t: 4.6,
    vf: "fps=30,setsar=1,zoompan=z='min(1.045,1+0.00034*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,eq=contrast=1.04:saturation=1.05",
  },
  {
    name: '02-craft-tandoor',
    ss: 16.8,
    t: 5.4,
    vf: 'fps=30,scale=1080:1920,setsar=1,eq=contrast=1.03:saturation=1.04',
  },
  {
    name: '03-bread-payoff',
    ss: 28.4,
    t: 4.2,
    vf: "fps=30,setsar=1,zoompan=z='min(1.035,1+0.00028*on)':x='iw/2-(iw/zoom/2)':y='ih*0.54-(ih/zoom/2)':d=1:s=1080x1920:fps=30,eq=contrast=1.04:saturation=1.06",
  },
  {
    name: '04-ending-craft',
    ss: 37.2,
    t: 3.8,
    vf: 'fps=30,scale=1080:1920,setsar=1,eq=contrast=1.03:saturation=1.04,fade=t=out:st=3.1:d=0.7',
  },
];

for (const take of takes) {
  await run(ffmpeg, [
    '-y',
    '-ss',
    String(take.ss),
    '-t',
    String(take.t),
    '-i',
    srcC1,
    '-vf',
    take.vf,
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'fast',
    '-crf',
    '18',
    path.join(takesDir, `${take.name}.mp4`),
  ]);
}

const list = takes
  .map((take) => `file '${path.join(takesDir, `${take.name}.mp4`).replaceAll('\\', '/')}'`)
  .join('\n');
writeFileSync(path.join(takesDir, 'concat.txt'), list);
const concatOut = path.join(takesDir, 'concat.mp4');
await run(ffmpeg, [
  '-y',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  path.join(takesDir, 'concat.txt'),
  '-c',
  'copy',
  concatOut,
]);

const videoDuration = await probeDuration(concatOut);
const endCard = path.join(takesDir, 'end-casa.mp4');
await run(ffmpeg, [
  '-y',
  '-f',
  'lavfi',
  '-i',
  'color=c=0x0a0a0a:s=1080x1920:d=0.9:r=30',
  '-vf',
  "drawtext=fontfile='C\\:/Windows/Fonts/georgia.ttf':text='Casa':fontsize=54:fontcolor=0xf4efe6:x=(w-text_w)/2:y=(h-text_h)/2",
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-t',
  '0.9',
  endCard,
]);

const withEnd = path.join(takesDir, 'concat-end.mp4');
writeFileSync(
  path.join(takesDir, 'concat-end.txt'),
  `file '${concatOut.replaceAll('\\', '/')}'\nfile '${endCard.replaceAll('\\', '/')}'\n`,
);
await run(ffmpeg, [
  '-y',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  path.join(takesDir, 'concat-end.txt'),
  '-c',
  'copy',
  withEnd,
]);

const finalOut = path.join(root, 'quality-first.mp4');
const audioDur = (videoDuration + 0.9).toFixed(3);
await run(ffmpeg, [
  '-y',
  '-i',
  withEnd,
  '-ss',
  '2.8',
  '-t',
  audioDur,
  '-i',
  srcC1,
  '-filter_complex',
  '[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.25,afade=t=out:st=' +
    (Number(audioDur) - 0.85).toFixed(2) +
    ':d=0.8[a]',
  '-map',
  '0:v',
  '-map',
  '[a]',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-preset',
  'fast',
  '-crf',
  '18',
  '-c:a',
  'aac',
  '-ar',
  '48000',
  '-ac',
  '2',
  '-b:a',
  '160k',
  '-shortest',
  '-movflags',
  '+faststart',
  finalOut,
]);

const percents = [5, 15, 30, 50, 70, 85, 95];
const duration = await probeDuration(finalOut);
for (const pct of percents) {
  const ss = Math.max(0, (duration * pct) / 100 - 0.04);
  await run(ffmpeg, [
    '-y',
    '-ss',
    ss.toFixed(3),
    '-i',
    finalOut,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    '-pix_fmt',
    'yuvj420p',
    path.join(root, 'inspect', `qf2-${pct}.jpg`),
  ]);
}

for (const take of takes) {
  await run(ffmpeg, [
    '-y',
    '-ss',
    '0.35',
    '-i',
    path.join(takesDir, `${take.name}.mp4`),
    '-frames:v',
    '1',
    '-q:v',
    '3',
    '-pix_fmt',
    'yuvj420p',
    path.join(root, 'inspect', `take2-${take.name}.jpg`),
  ]);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      output: finalOut,
      duration,
      rejected_v1: rejected,
      strategy: 'c1-led-static-slow-push',
      cameras_used: ['C1'],
      cameras_rejected: {
        C2: 'underexposed',
        C3: 'different kitchen collage',
        C4: 'watermark + different restaurant + failed fire crop',
      },
    },
    null,
    2,
  ),
);
