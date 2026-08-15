import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { probeVideo } from './probe.mjs';

export function offsetMs(timezoneOffset = '-03:00') {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(timezoneOffset);
  if (!match) return -3 * 60 * 60 * 1000;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60 * 1000;
}

export function formatCompactStamp(date, timezoneOffset = '-03:00') {
  const local = new Date(date.getTime() + offsetMs(timezoneOffset));
  const pad = (value) => String(value).padStart(2, '0');
  return `${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}T${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}${pad(local.getUTCSeconds())}`;
}

export function rtspSegmentName({ position, startedAt, endedAt, timezoneOffset = '-03:00' }) {
  const cam = `cam-${String(position).padStart(2, '0')}`;
  return `${cam}_${formatCompactStamp(startedAt, timezoneOffset)}_${formatCompactStamp(endedAt, timezoneOffset)}.mp4`;
}

export function redactRtsp(text) {
  return String(text ?? '').replace(/rtsps?:\/\/[^\s'"]+/gi, 'rtsp://***');
}

export function rtspIdentity(url) {
  const value = String(url ?? '');
  const at = value.lastIndexOf('@');
  return at === -1 ? value.replace(/^rtsps?:\/\//i, '') : value.slice(at + 1);
}

export const RTSP_PROFILES = ['copy_aac', 'copy_an', 'x264'];

export function rtspFfmpegArgs({
  url,
  output,
  segmentSeconds,
  transport = 'tcp',
  profile = 'copy_aac',
}) {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-rtsp_transport',
    transport,
    '-stimeout',
    '5000000',
    '-i',
    url,
    '-t',
    String(segmentSeconds),
  ];
  if (profile === 'copy_an') args.push('-c:v', 'copy', '-an');
  else if (profile === 'x264') args.push('-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac');
  else args.push('-c:v', 'copy', '-c:a', 'aac');
  args.push('-y', output);
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runFfmpeg(ffmpegPath, args, onChild) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    onChild?.(child);
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 2000) stderr = stderr.slice(-2000);
    });
    child.on('error', () => resolve({ code: 1, stderr: 'FFMPEG_SPAWN' }));
    child.on('close', (code) => resolve({ code: code ?? 1, stderr: redactRtsp(stderr) }));
  });
}

async function salvageSegment(output, { position, startedAt, timezoneOffset, outputDir }) {
  if (!existsSync(output) || statSync(output).size <= 10_000) return null;
  try {
    const probe = await probeVideo(output);
    if (!(probe.duration > 2) || !probe.hasVideo) return null;
    const endedAt = new Date(startedAt.getTime() + probe.duration * 1000);
    const dest = path.join(
      outputDir,
      rtspSegmentName({ position, startedAt, endedAt, timezoneOffset }),
    );
    if (dest !== output) renameSync(output, dest);
    return { dest, bytes: statSync(dest).size, duration: probe.duration };
  } catch {
    return null;
  }
}

export function createRtspRecorder({
  url,
  position,
  outputDir,
  segmentSeconds = 60,
  timezoneOffset = '-03:00',
  transport = 'tcp',
  ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
  log,
}) {
  let stopping = false;
  let child = null;
  const key = `${position}:${rtspIdentity(url)}:${transport}`;

  async function loop() {
    mkdirSync(outputDir, { recursive: true });
    let profileIndex = 0;
    while (!stopping) {
      const startedAt = new Date();
      const endedAt = new Date(startedAt.getTime() + segmentSeconds * 1000);
      const output = path.join(
        outputDir,
        rtspSegmentName({ position, startedAt, endedAt, timezoneOffset }),
      );
      const profile = RTSP_PROFILES[profileIndex] ?? 'copy_aac';
      const args = rtspFfmpegArgs({ url, output, segmentSeconds, transport, profile });
      const result = await runFfmpeg(ffmpegPath, args, (spawned) => {
        child = spawned;
      });
      child = null;
      if (stopping) {
        try {
          if (existsSync(output)) unlinkSync(output);
        } catch {
          /* ignore */
        }
        break;
      }
      const size = existsSync(output) ? statSync(output).size : 0;
      if (result.code === 0 && size > 10_000) {
        log?.({ event: 'rtsp_segment', position, bytes: size, profile });
        continue;
      }
      const kept = await salvageSegment(output, { position, startedAt, timezoneOffset, outputDir });
      if (kept) {
        log?.({ event: 'rtsp_segment', position, bytes: kept.bytes, profile, salvaged: true });
        continue;
      }
      try {
        if (existsSync(output)) unlinkSync(output);
      } catch {
        /* ignore */
      }
      profileIndex = (profileIndex + 1) % RTSP_PROFILES.length;
      log?.({
        event: 'rtsp_retry',
        position,
        transport,
        profile,
        error: redactRtsp(result.stderr?.slice(-240) || `ffmpeg ${result.code}`),
      });
      await sleep(4000);
    }
  }

  return {
    key,
    position,
    start() {
      stopping = false;
      void loop();
    },
    async stop() {
      stopping = true;
      if (!child) return;
      try {
        child.kill('SIGTERM');
      } catch {
        /* already dead */
      }
      await Promise.race([new Promise((resolve) => child.once('close', resolve)), sleep(4000)]);
      if (child && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        await sleep(200);
      }
      child = null;
    },
  };
}
