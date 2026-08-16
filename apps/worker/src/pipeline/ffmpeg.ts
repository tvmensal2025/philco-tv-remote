import { cropNeedsPadBlur, snapPlaybackSpeed } from '@reelops/shared';
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { ffmpegSlot } from '../engine/provider-slots.js';
import { log } from '../services.js';
import type { ReelPlan } from '../engine/planner.js';
import {
  deliveryAudioEncodeArgs,
  deliveryAudioFilter,
  mixBackgroundMusicGraph,
  mixVoiceoverGraph,
  loudnormThenFade,
  liveStageBed,
} from './audio.js';
import { pickMusicBed } from './music-bed.js';
import { ffmpegSubtitlesFilter } from './captions.js';
import {
  parseLoudness,
  parseSceneCuts,
  parseSilences,
  selectPeaks,
  midrollBlackHits,
  type PeakWindow,
} from './ffmpeg-scan.js';
import {
  ffmpegSourceCrop,
  joinOverlayFilter,
  joinTimelineStarts,
  logoOverlayFilter,
  endCardPlateFilter,
  masterFinish,
  packOverlayFilter,
  takeFilter,
  takeFilterStatic,
  takeTrimFilter,
  xfadeChain,
  concatChain,
  usesHardCutJoins,
  rewrittenJoin,
  joinProfileFor,
  type PackOverlayHit,
} from './finish.js';
import { loadFxCatalogFromDisk, resolveFxAssetPath } from './fx-assets.js';
import {
  isFfmpegMemoryError,
  renderProfileOrder,
  type RenderProfile,
  type RenderResult,
  type RenderWarning,
} from './render-profile.js';

export type { RenderProfile, RenderResult, RenderWarning } from './render-profile.js';
export { isFfmpegMemoryError, renderProfileOrder } from './render-profile.js';

export type VerticalBrandPass = {
  logoPath?: string | null;
  endCard?: boolean;
  musicPath?: string | null;
};

function ffmpegGlobals() {
  const threads = config.FFMPEG_THREADS;
  if (threads <= 0) return [] as string[];
  return ['-threads', String(threads), '-filter_threads', '1'];
}

function resolveMediaBinary(binary: string) {
  if (binary === 'ffmpeg') return process.env.FFMPEG_PATH || 'ffmpeg';
  if (binary === 'ffprobe') return process.env.FFPROBE_PATH || 'ffprobe';
  return binary;
}

export async function run(binary: string, args: string[], timeoutMs = 15 * 60 * 1000) {
  if (binary === 'ffmpeg') return ffmpegSlot.run(() => runUncapped(binary, args, timeoutMs));
  return runUncapped(binary, args, timeoutMs);
}

async function runUncapped(binary: string, args: string[], timeoutMs: number) {
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
  if (binary === 'ffmpeg')
    return ffmpegSlot.run(() => runAllowFailUncapped(binary, args, timeoutMs));
  return runAllowFailUncapped(binary, args, timeoutMs);
}

async function runAllowFailUncapped(binary: string, args: string[], timeoutMs: number) {
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

export async function extractJpegFrameAt(input: string, atSeconds: number, output: string) {
  await mkdir(path.dirname(output), { recursive: true });
  const source = input.replaceAll('\\', '/');
  const dest = output.replaceAll('\\', '/');
  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...(source.endsWith('.txt') ? ['-f', 'concat', '-safe', '0'] : []),
      '-ss',
      String(Math.max(0, atSeconds)),
      '-i',
      source,
      '-frames:v',
      '1',
      '-q:v',
      '4',
      dest,
    ],
    30_000,
  );
  return output;
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
  brand?: VerticalBrandPass,
): Promise<RenderResult> {
  if (!plan.scenes.length) throw new Error('NO_SCENES_IN_PLAN');
  const start = config.RENDER_PROFILE;
  const order = renderProfileOrder(start);
  const variants: ReelPlan[] = [plan];
  if (
    plan.scenes.some(
      (scene) => snapPlaybackSpeed(scene.speed ?? 1) !== 1 || Boolean(scene.fxAssetId),
    )
  ) {
    variants.push({
      ...plan,
      scenes: plan.scenes.map((scene) => ({ ...scene, speed: 1, fxAssetId: undefined })),
    });
  }
  let lastError: unknown;
  let memoryPressure = false;
  for (const [variantIndex, variant] of variants.entries()) {
    for (const profile of order) {
      try {
        await renderFinished(variant, output, captionsPath, profile, voicePath, brand);
        const fell = profile !== start || variantIndex > 0;
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
            brand_logo: Boolean(brand?.logoPath),
            brand_end_card: Boolean(brand?.endCard),
            speed_stripped: variantIndex > 0,
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
            speed_stripped: variantIndex > 0,
            err: error instanceof Error ? error.message.slice(0, 400) : String(error),
          },
          'render profile failed; downgrading',
        );
      }
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
  brand?: VerticalBrandPass,
) {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];
  plan.scenes.forEach((scene) => {
    const source = scene.source_recording_path.replaceAll('\\', '/');
    args.push(...(source.endsWith('.txt') ? ['-f', 'concat', '-safe', '0'] : []), '-i', source);
  });
  const musicPath = (
    brand?.musicPath ?? pickMusicBed(plan.scenes[0]?.camera_id ?? plan.program)?.source
  )?.replaceAll('\\', '/');
  if (musicPath) args.push('-i', musicPath);
  if (voicePath) args.push('-i', voicePath.replaceAll('\\', '/'));
  const logoPath = brand?.logoPath ? brand.logoPath.replaceAll('\\', '/') : null;
  if (logoPath) args.push('-i', logoPath);
  let nextInput = plan.scenes.length;
  const musicInputIndex = musicPath ? nextInput++ : undefined;
  const voiceInputIndex = voicePath ? nextInput++ : undefined;
  const logoInputIndex = logoPath ? nextInput++ : undefined;

  if (profile === 'safe') {
    const scenes = plan.scenes.map((scene) => ({ ...scene, speed: 1, fxAssetId: undefined }));
    const videoFilters = scenes.map((scene, index) =>
      scene.cropMode === 'pad_blur' || cropNeedsPadBlur(scene)
        ? takeFilterStatic({ ...scene, cropTight: true, punchIn: false }, index)
        : `[${index}:v]${takeTrimFilter(scene)},${ffmpegSourceCrop(scene.crop, scene.cropFilter)}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v${index}]`,
    );
    const concat = `${scenes.map((_, index) => `[v${index}]`).join('')}concat=n=${scenes.length}:v=1:a=0[basev]`;
    await mapAndEncode(
      plan,
      args,
      [...videoFilters, concat],
      '[basev]',
      output,
      captionsPath,
      undefined,
      {
        logoInputIndex,
        endCard: Boolean(brand?.endCard),
        musicInputIndex,
        voiceInputIndex,
      },
      profile,
    );
    return;
  }

  const videoFilters = plan.scenes.map((scene, index) =>
    profile === 'high' ? takeFilter(scene, index) : takeFilterStatic(scene, index),
  );
  const joinProfile = joinProfileFor(plan.program, profile);
  const joinScenes = plan.scenes.map((scene) => ({
    duration: scene.duration,
    transition: rewrittenJoin(scene.transition, joinProfile),
    joinDuration:
      rewrittenJoin(scene.transition, joinProfile) === 'cut' ? undefined : scene.joinDuration,
    joinOverlay: scene.joinOverlay,
  }));
  const chain = usesHardCutJoins(plan.scenes, joinProfile)
    ? concatChain(plan.scenes)
    : xfadeChain(joinScenes);
  const packHits = collectPackOverlayHits(plan, args, nextInput);
  const packedScenes = new Set(packHits.map((hit) => hit.sceneIndex));
  const overlay = joinOverlayFilter(
    joinScenes.map((scene, index) => ({
      ...scene,
      joinOverlay: packedScenes.has(index) ? undefined : scene.joinOverlay,
    })),
  );
  const fadeOut = plan.scenes.at(-1)?.fadeOut !== false;
  const filters = [...videoFilters, chain.filter];
  if (overlay.filter) filters.push(overlay.filter);
  let videoOut = overlay.output;
  if (packHits.length) {
    const packs = packOverlayFilter(packHits, videoOut);
    if (packs.filter) filters.push(packs.filter);
    videoOut = packs.output;
  }
  filters.push(
    masterFinish(chain.duration, fadeOut, profile === 'high' ? 'high' : 'standard', videoOut),
  );
  await mapAndEncode(
    plan,
    args,
    filters,
    '[basev]',
    output,
    captionsPath,
    chain.duration,
    {
      logoInputIndex,
      endCard: Boolean(brand?.endCard),
      musicInputIndex,
      voiceInputIndex,
    },
    profile,
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
  brand?: {
    logoInputIndex?: number;
    endCard?: boolean;
    musicInputIndex?: number;
    voiceInputIndex?: number;
  },
  profile: RenderProfile = 'standard',
) {
  const graph = [...filters];
  let map = videoMap;
  if (typeof brand?.logoInputIndex === 'number') {
    graph.push(logoOverlayFilter(map, brand.logoInputIndex));
    map = '[logov]';
  }
  const duration = audioDuration ?? plan.duration;
  if (brand?.endCard) {
    graph.push(endCardPlateFilter(map, duration));
    map = '[endv]';
  }
  if (captionsPath) {
    graph.push(`${map}${ffmpegSubtitlesFilter(captionsPath)}[capv]`);
    map = '[capv]';
  }
  const audioIndex = plan.audio
    ? plan.scenes.findIndex(
        (scene) => scene.source_recording_path === plan.audio?.source_recording_path,
      )
    : -1;
  const speedWarped = plan.scenes.some((scene) => snapPlaybackSpeed(scene.speed ?? 1) !== 1);
  const ambientIndex = plan.audio && !speedWarped ? (audioIndex >= 0 ? audioIndex : 0) : undefined;
  const hasVoice = typeof brand?.voiceInputIndex === 'number';
  const hasMusic = typeof brand?.musicInputIndex === 'number';
  const liveStage = plan.program === 'casa' && ambientIndex != null;
  if (hasMusic) {
    graph.push(
      mixBackgroundMusicGraph({
        musicInputIndex: brand!.musicInputIndex!,
        duration,
        ambientInputIndex: ambientIndex,
        ambientStart: plan.audio?.source_start_offset,
        musicStart: plan.music?.startSeconds,
        voiceInputIndex: hasVoice ? brand!.voiceInputIndex : undefined,
        ducking: liveStage ? liveStageBed : undefined,
      }),
    );
  } else if (hasVoice) {
    graph.push(
      mixVoiceoverGraph({
        ambientInputIndex: ambientIndex,
        ambientStart: plan.audio?.source_start_offset,
        voiceInputIndex: brand!.voiceInputIndex!,
        duration,
      }),
    );
  } else if (plan.audio) {
    const inputIndex = ambientIndex ?? 0;
    graph.push(
      `[${inputIndex}:a]atrim=start=${plan.audio.source_start_offset}:duration=${duration},asetpts=PTS-STARTPTS,${deliveryAudioFilter()},${loudnormThenFade({ duration, loudnormI: -16 })}[outa]`,
    );
  }
  args.push('-filter_complex', graph.join(';'), '-map', map);
  if (hasMusic || hasVoice || plan.audio) args.push('-map', '[outa]', ...deliveryAudioEncodeArgs());
  else args.push('-an');
  const delivery = profile !== 'safe';
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    delivery ? 'medium' : 'veryfast',
    '-crf',
    delivery ? '18' : '20',
    '-pix_fmt',
    'yuv420p',
    '-t',
    String(Number(duration.toFixed(3))),
    '-movflags',
    '+faststart',
    output,
  );
  await run('ffmpeg', args, 20 * 60 * 1000);
}

/** Fail ready when picture dies in the middle. Opening/closing fades are allowed. */
export async function assertPictureThroughout(input: string, duration: number) {
  const log = await runAllowFail(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      input,
      '-vf',
      'blackdetect=d=0.35:pix_th=0.12',
      '-an',
      '-f',
      'null',
      '-',
    ],
    3 * 60 * 1000,
  );
  const mid = midrollBlackHits(log, duration);
  if (mid.length) {
    throw new Error(`PICTURE_DEAD:${mid[0]!.start}-${mid[0]!.end}`);
  }
}

function collectPackOverlayHits(
  plan: ReelPlan,
  args: string[],
  firstInput: number,
): PackOverlayHit[] {
  const catalog = loadFxCatalogFromDisk();
  if (!catalog.assets.length) return [];
  const byId = new Map(catalog.assets.map((asset) => [asset.id, asset]));
  const starts = joinTimelineStarts(plan.scenes);
  const hits: PackOverlayHit[] = [];
  let input = firstInput;
  plan.scenes.forEach((scene, index) => {
    if (!scene.fxAssetId) return;
    const asset = byId.get(scene.fxAssetId);
    if (!asset) return;
    const file = resolveFxAssetPath(asset);
    if (!file) return;
    args.push('-i', file.replaceAll('\\', '/'));
    hits.push({
      start: Number((starts[index] ?? 0).toFixed(3)),
      duration: Math.max(0.12, Math.min(scene.duration, asset.durationMs / 1000)),
      inputIndex: input,
      blend: asset.blend,
      sceneIndex: index,
    });
    input += 1;
  });
  return hits;
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
