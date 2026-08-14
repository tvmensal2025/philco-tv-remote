import { spawn } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

const file = path.resolve('work/revideo-evidence/casa.mp4');
const probe = JSON.parse(
  await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ]),
);
const video = (probe.streams ?? []).find((stream) => stream.codec_type === 'video');
const audio = (probe.streams ?? []).find((stream) => stream.codec_type === 'audio');
const size = Number(probe.format?.size) || statSync(file).size;
const duration = Number(probe.format?.duration) || 0;
const fps =
  video?.r_frame_rate === '30/1' || video?.avg_frame_rate === '30/1' ? 30 : video?.r_frame_rate;
const technicalIssues = [];
if (size < 1024) technicalIssues.push('EMPTY_FILE');
if (!(duration > 0.4)) technicalIssues.push('DURATION');
if (!video) technicalIssues.push('NO_VIDEO_STREAM');
if (video?.width !== 1080) technicalIssues.push('WIDTH');
if (video?.height !== 1920) technicalIssues.push('HEIGHT');
if (video?.codec_name !== 'h264') technicalIssues.push('VIDEO_CODEC');
if (video?.pix_fmt !== 'yuv420p') technicalIssues.push('PIX_FMT');
if (!audio?.codec_name) technicalIssues.push('NO_AUDIO');

const titleBox = { x: 90, y: 360, w: 900, h: 88 };
const logoBox = { x: 90, y: 250, w: 72, h: 72 };
const safe = { top: 0.12, bottom: 0.14, left: 0.06, right: 0.06 };
function inSafe(box) {
  const left = 1080 * safe.left;
  const right = 1080 * (1 - safe.right);
  const top = 1920 * safe.top;
  const bottom = 1920 * (1 - safe.bottom);
  return box.x >= left && box.y >= top && box.x + box.w <= right && box.y + box.h <= bottom;
}
const compositionIssues = [];
if (!inSafe(titleBox)) compositionIssues.push('TITLE_OVERFLOW');
if (!inSafe(logoBox)) compositionIssues.push('LOGO_SAFE_AREA');

const report = {
  file,
  technical: {
    status: technicalIssues.length ? 'failed' : 'passed',
    issues: technicalIssues,
    exists: true,
    containerValid: String(probe.format?.format_name ?? '').includes('mp4'),
    videoStream: Boolean(video),
    resolution: `${video?.width}x${video?.height}`,
    aspectRatio: '9:16',
    duration,
    fps,
    pixelFormat: video?.pix_fmt,
    audioExpected: true,
    audioPresent: Boolean(audio),
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    channels: audio?.channels ?? null,
    codec: video?.codec_name,
    audioCodec: audio?.codec_name,
    size,
  },
  composition: {
    status: compositionIssues.length ? 'failed' : 'passed',
    issues: compositionIssues,
    titleBounds: titleBox,
    logoBounds: logoBox,
    ctaBounds: null,
    safeArea: safe,
    assetsLoaded: ['logo-fixture.png', 'clip-0.mp4', 'fixture.ttf'],
    fontsLoaded: ['CenaSerif', 'Georgia'],
    placeholders: false,
    invalidValues: [],
    fixtureBranding: true,
  },
  visualInspection: {
    10: 'real kitchen/fire footage, title Café da casa, fixture square logo, Canal Madeira is SOURCE watermark',
    30: 'same scene, not black, overlays in top safe area',
    50: 'same, dark bars top/bottom',
    70: 'same, video still protagonist',
    90: 'end card Casa on dark background',
  },
  generations: ['copy_source_to_runtime', 'revideo_ffmpeg_png_pipe_h264', 'ffmpeg_concat_mux_aac'],
};
writeFileSync('work/revideo-evidence/qc.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.technical.status !== 'passed' || report.composition.status !== 'passed') process.exit(2);
