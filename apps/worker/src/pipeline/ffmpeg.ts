import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { log } from '../services.js';
import type { ReelPlan } from '../engine/planner.js';
import { mixVoiceoverGraph } from './audio.js';
import { ffmpegSubtitlesFilter } from './captions.js';
import {
  parseLoudness,
  parseSceneCuts,
  parseSilences,
  selectPeaks,
  type PeakWindow,
} from './ffmpeg-scan.js';
import {
  ffmpegSourceCrop,
  joinOverlayFilter,
  masterFinish,
  takeFilter,
  takeFilterStatic,
  xfadeChain,
} from './finish.js';
import {
  isFfmpegMemoryError,
  renderProfileOrder,
  type RenderProfile,
  type RenderResult,
  type RenderWarning,
} from './render-profile.js';

export type { RenderProfile, RenderResult, RenderWarning } from './render-profile.js';
export { isFfmpegMemoryError, renderProfileOrder } from './render-profile.js';

function ffmpegGlobals() {
  const threads = config.FFMPEG_THREADS;
  if (threads <= 0) return [] as string[];
  return ['-threads', String(threads), '-filter_threads', String(Math.max(1, threads))];
}

function resolveMediaBinary(binary: string) {
  if (binary === 'ffmpeg') return process.env.FFMPEG_PATH || 'ffmpeg';
  if (binary === 'ffprobe') return process.env.FFPROBE_PATH || 'ffprobe';
  return binary;
}

export async function run(binary: string, args: string[], timeoutMs = 15 * 60 * 1000) {
  const resolved = resolveMediaBinary(binary);
  const finalArgs = binary === 'ffmpeg' ? [...ffmpegGlobals(), ...args] : args;
  return new Promise<string>((resolve, reject) => {
    const child = spawn(resolved, finalArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${binary.toUpperCase()}_TIMEOUT`));
    }, timeoutMs);
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(`${stdout}\n${stderr}`);
      else reject(new Error(`${binary} (${code}): ${stderr.slice(-1800)}`));
    });
  });
}

export async function runAllowFail(binary: string, args: string[], timeoutMs = 2 * 60 * 1000) {
  const resolved = resolveMediaBinary(binary);
  const finalArgs = binary === 'ffmpeg' ? [...ffmpegGlobals(), ...args] : args;
  return new Promise<string>((resolve, reject) => {
    const child = spawn(resolved, finalArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${binary.toUpperCase()}_TIMEOUT`));
    }, timeoutMs);
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', () => {
      clearTimeout(timeout);
      resolve(output);
    });
  });
}

export async function hasAudioStream(input: string) {
  const output = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      input,
    ],
    30_000,
  );
  return output.trim().split(/\s+/)[0] === 'audio';
}

export async function probeDuration(input: string) {
  const output = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      input,
    ],
    30_000,
  );
  const duration = Number(output.trim().split(/\s+/)[0]);
  if (!Number.isFinite(duration)) throw new Error('INVALID_OUTPUT_DURATION');
  return duration;
}

export async function extractJpegFrames(
  input: string,
  outputDir: string,
  everySeconds = 2,
  maxFrames = 4,
) {
  await mkdir(outputDir, { recursive: true });
  const pattern = path.join(outputDir, 'frame-%03d.jpg').replaceAll('\\', '/');
  const source = input.replaceAll('\\', '/');
  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...(source.endsWith('.txt') ? ['-f', 'concat', '-safe', '0'] : []),
      '-i',
      source,
      '-vf',
      `fps=1/${Math.max(1, everySeconds)},scale=480:-2`,
      '-q:v',
      '6',
      '-frames:v',
      String(maxFrames),
      pattern,
    ],
    60_000,
  );
  return (await readdir(outputDir))
    .filter((name) => name.endsWith('.jpg'))
    .sort()
    .map((name) => path.join(outputDir, name));
}

export async function extractClip(
  input: string,
  startSeconds: number,
  durationSeconds: number,
  output: string,
) {
  const source = input.replaceAll('\\', '/');
  const concat = source.endsWith('.txt');
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...(concat ? ['-f', 'concat', '-safe', '0'] : []),
    '-ss',
    String(Math.max(0, startSeconds)),
    '-i',
    source,
    '-t',
    String(Math.max(1, durationSeconds)),
    '-vf',
    'scale=-2:720',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    config.FFMPEG_PRESET,
    '-crf',
    '28',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  ];
  await run('ffmpeg', args, 2 * 60 * 1000);
}

export async function scanSegment(
  input: string,
  durationSeconds: number,
  options?: { maxPeaks?: number; fast?: boolean; startSeconds?: number },
): Promise<PeakWindow[]> {
  const start = Math.max(0, options?.startSeconds ?? 0);
  const trim =
    start > 0 || options?.fast
      ? ['-ss', String(start), '-t', String(Math.max(1, durationSeconds))]
      : [];
  const sceneLog = await runAllowFail('ffmpeg', [
    '-hide_banner',
    ...trim,
    '-i',
    input,
    '-vf',
    "select='gt(scene,0.22)',showinfo",
    '-an',
    '-f',
    'null',
    '-',
  ]);
  const [loudLog, silenceLog] = options?.fast
    ? ['', '']
    : await Promise.all([
        runAllowFail('ffmpeg', [
          '-hide_banner',
          ...trim,
          '-i',
          input,
          '-af',
          'ebur128=peak=true',
          '-f',
          'null',
          '-',
        ]),
        runAllowFail('ffmpeg', [
          '-hide_banner',
          ...trim,
          '-i',
          input,
          '-af',
          'silencedetect=n=-35dB:d=0.4',
          '-f',
          'null',
          '-',
        ]),
      ]);
  const peaks = selectPeaks({
    durationSeconds,
    scenes: parseSceneCuts(sceneLog),
    loudness: parseLoudness(loudLog),
    silences: parseSilences(silenceLog, durationSeconds),
    maxPeaks: options?.maxPeaks ?? 2,
  });
  return peaks.map((peak) => ({ ...peak, offsetSeconds: peak.offsetSeconds + start }));
}

export async function renderVertical(
  plan: ReelPlan,
  output: string,
  captionsPath?: string | null,
  voicePath?: string | null,
): Promise<RenderResult> {
  if (!plan.scenes.length) throw new Error('NO_SCENES_IN_PLAN');
  const start = config.RENDER_PROFILE;
  const order = renderProfileOrder(start);
  let lastError: unknown;
  let memoryPressure = false;
  for (const profile of order) {
    try {
      await renderFinished(plan, output, captionsPath, profile, voicePath);
      const fell = profile !== start;
      const used = profile === 'safe' && fell ? 'safe_fallback' : profile;
      const warning: RenderWarning | undefined = !fell
        ? undefined
        : memoryPressure
          ? 'MOTION_FILTER_MEMORY_FALLBACK'
          : 'RENDER_PROFILE_DOWNGRADE';
      log.info(
        {
          program: plan.program,
          render_profile_used: used,
          render_warning: warning ?? null,
          scenes: plan.scenes.length,
          ffmpegThreads: config.FFMPEG_THREADS,
        },
        'render finished',
      );
      return { profile: used, warning };
    } catch (error) {
      lastError = error;
      if (isFfmpegMemoryError(error)) memoryPressure = true;
      log.warn(
        {
          program: plan.program,
          profile,
          memory: isFfmpegMemoryError(error),
          err: error instanceof Error ? error.message.slice(0, 400) : String(error),
        },
        'render profile failed; downgrading',
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error('RENDER_FAILED');
}

async function renderFinished(
  plan: ReelPlan,
  output: string,
  captionsPath: string | null | undefined,
  profile: RenderProfile,
  voicePath?: string | null,
) {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];
  plan.scenes.forEach((scene) => {
    const source = scene.source_recording_path.replaceAll('\\', '/');
    args.push(...(source.endsWith('.txt') ? ['-f', 'concat', '-safe', '0'] : []), '-i', source);
  });
  if (voicePath) args.push('-i', voicePath.replaceAll('\\', '/'));

  if (profile === 'safe') {
    const videoFilters = plan.scenes.map(
      (scene, index) =>
        `[${index}:v]trim=start=${scene.source_start_offset}:duration=${scene.duration},setpts=PTS-STARTPTS,${ffmpegSourceCrop(scene.crop)}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v${index}]`,
    );
    const concat = `${plan.scenes.map((_, index) => `[v${index}]`).join('')}concat=n=${plan.scenes.length}:v=1:a=0[basev]`;
    await mapAndEncode(
      plan,
      args,
      [...videoFilters, concat],
      '[basev]',
      output,
      captionsPath,
      undefined,
      voicePath,
    );
    return;
  }

  const videoFilters = plan.scenes.map((scene, index) =>
    profile === 'high' ? takeFilter(scene, index) : takeFilterStatic(scene, index),
  );
  const chain = xfadeChain(
    plan.scenes.map((scene) => ({
      duration: scene.duration,
      transition:
        profile === 'high'
          ? scene.transition
          : scene.transition === 'dissolve'
            ? 'cut'
            : scene.transition,
      joinDuration: scene.joinDuration,
    })),
  );
  const overlay = joinOverlayFilter(
    plan.scenes.map((scene) => ({
      duration: scene.duration,
      transition:
        profile === 'high'
          ? scene.transition
          : scene.transition === 'dissolve'
            ? 'cut'
            : scene.transition,
      joinDuration: scene.joinDuration,
      joinOverlay: scene.joinOverlay,
    })),
  );
  const fadeOut = plan.scenes.at(-1)?.fadeOut !== false;
  const filters = [...videoFilters, chain.filter];
  if (overlay.filter) filters.push(overlay.filter);
  filters.push(
    masterFinish(chain.duration, fadeOut, profile === 'high' ? 'high' : 'standard', overlay.output),
  );
  await mapAndEncode(
    plan,
    args,
    filters,
    '[basev]',
    output,
    captionsPath,
    chain.duration,
    voicePath,
  );
}

async function mapAndEncode(
  plan: ReelPlan,
  args: string[],
  filters: string[],
  videoMap: string,
  output: string,
  captionsPath?: string | null,
  audioDuration?: number,
  voicePath?: string | null,
) {
  const graph = [...filters];
  let map = videoMap;
  if (captionsPath) {
    graph.push(`${videoMap}${ffmpegSubtitlesFilter(captionsPath)}[capv]`);
    map = '[capv]';
  }
  const duration = audioDuration ?? plan.duration;
  if (voicePath) {
    const audioIndex = plan.audio
      ? plan.scenes.findIndex(
          (scene) => scene.source_recording_path === plan.audio?.source_recording_path,
        )
      : -1;
    graph.push(
      mixVoiceoverGraph({
        ambientInputIndex: plan.audio ? (audioIndex >= 0 ? audioIndex : 0) : undefined,
        ambientStart: plan.audio?.source_start_offset,
        voiceInputIndex: plan.scenes.length,
        duration,
      }),
    );
  } else if (plan.audio) {
    const audioIndex = plan.scenes.findIndex(
      (scene) => scene.source_recording_path === plan.audio?.source_recording_path,
    );
    const inputIndex = audioIndex >= 0 ? audioIndex : 0;
    const fadeOutStart = Math.max(0, duration - 0.8);
    graph.push(
      `[${inputIndex}:a]atrim=start=${plan.audio.source_start_offset}:duration=${duration},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.55,afade=t=out:st=${fadeOutStart}:d=0.8,aresample=async=1,loudnorm=I=-16:TP=-1.5:LRA=11[outa]`,
    );
  }
  args.push('-filter_complex', graph.join(';'), '-map', map);
  if (voicePath || plan.audio) args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '192k');
  else args.push('-an');
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    config.FFMPEG_PRESET,
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  );
  await run('ffmpeg', args);
}

export async function makeThumbnail(input: string, output: string) {
  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      '1',
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      'scale=540:960',
      output,
    ],
    60_000,
  );
}
