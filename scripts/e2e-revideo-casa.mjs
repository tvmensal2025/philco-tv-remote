import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { renderVideo } from '@revideo/renderer';

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
      code === 0 ? resolve(stdout) : reject(new Error(stderr || `${binary} ${code}`)),
    );
  });
}

const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';
const repo = process.cwd();
const root = path.join(repo, 'apps/worker/revideo');
const runtime = path.join(root, 'public', 'runtime');
mkdirSync(runtime, { recursive: true });
mkdirSync(path.join(root, 'output'), { recursive: true });
const source = existsSync(path.join(repo, 'test-assets/e2e/cam-04.mp4'))
  ? path.join(repo, 'test-assets/e2e/cam-04.mp4')
  : path.join(repo, 'test-assets/e2e/cam-01.mp4');
copyFileSync(source, path.join(runtime, 'clip-0.mp4'));

console.log(JSON.stringify({ event: 'revideo_start', source, ffmpegBin }));
process.chdir(root);
const file = await renderVideo({
  projectFile: './project.ts',
  variables: {
    title: 'Café da casa',
    clips: [{ src: '/runtime/clip-0.mp4', duration: 4, start: 1 }],
    logoSrc: '/branding/logo-fixture.png',
    showLogo: true,
    cta: '',
    endCard: 'Casa',
  },
  settings: {
    outFile: 'casa.mp4',
    outDir: 'output',
    workers: 1,
    logProgress: true,
    projectSettings: {
      size: { x: 1080, y: 1920 },
      exporter: { name: '@revideo/core/ffmpeg', options: { format: 'mp4' } },
    },
    ffmpeg: { ffmpegLogLevel: 'error', ffmpegPath: ffmpegBin, ffprobePath: ffprobeBin },
    puppeteer: {
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--use-gl=angle',
        '--use-angle=swiftshader',
      ],
    },
    viteConfig: { server: { hmr: true } },
    viteBasePort: 9100,
  },
});
const resolved = path.isAbsolute(file) ? file : path.join(root, file);
const probe = JSON.parse(
  await run(ffprobeBin, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    resolved,
  ]),
);
const video = (probe.streams ?? []).find((stream) => stream.codec_type === 'video');
const audio = (probe.streams ?? []).find((stream) => stream.codec_type === 'audio');
console.log(
  JSON.stringify(
    {
      event: 'revideo_done',
      file: resolved,
      width: video?.width,
      height: video?.height,
      codec: video?.codec_name,
      pixFmt: video?.pix_fmt,
      fps: video?.r_frame_rate,
      audioCodec: audio?.codec_name ?? null,
      duration: Number(probe.format?.duration) || 0,
      size: Number(probe.format?.size) || 0,
    },
    null,
    2,
  ),
);
rmSync(runtime, { recursive: true, force: true });
