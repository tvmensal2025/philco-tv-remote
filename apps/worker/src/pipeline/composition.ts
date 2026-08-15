import { createRequire } from 'node:module';
import path from 'node:path';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { VideoEditDecisionV1 } from '@reelops/shared';
import { config } from '../config.js';
import type { ReelPlan } from '../engine/planner.js';
import { deliveryAudioEncodeArgs, deliveryAudioFilter } from './audio.js';
import { renderVertical, run, type RenderResult } from './ffmpeg.js';
import { casaCompositionLayout } from '../composition/design-system.js';
import { revideoRenderSettings, patchRevideoNavigationTimeout } from './revideo-settings.js';

export type CompositionInput = {
  plan: ReelPlan;
  decision: VideoEditDecisionV1;
  output: string;
  captionsPath?: string | null;
  voicePath?: string | null;
  logoPath?: string | null;
  endCard?: boolean;
  workDir: string;
};

export type CompositionRenderResult = RenderResult & {
  renderer: 'ffmpeg' | 'revideo';
  requested: 'ffmpeg' | 'revideo';
  fallbackReason?: string;
  generations?: string[];
  layout?: typeof casaCompositionLayout;
  fixtureBranding?: boolean;
  strategy?: 'ffmpeg' | 'revideo_full' | 'hybrid_ffmpeg_timeline_revideo_branding';
  timings?: {
    ffmpegTimelineMs?: number;
    revideoMs?: number;
    muxMs?: number;
    wallMs?: number;
  };
};

export interface CompositionRenderer {
  readonly kind: 'ffmpeg' | 'revideo';
  render(input: CompositionInput): Promise<CompositionRenderResult>;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../revideo');
const BRANDING_END_S = 0.9;

export class FFmpegCompositionRenderer implements CompositionRenderer {
  readonly kind = 'ffmpeg' as const;
  async render(input: CompositionInput): Promise<CompositionRenderResult> {
    const result = await renderVertical(
      input.plan,
      input.output,
      input.captionsPath,
      input.voicePath,
      { logoPath: input.logoPath, endCard: input.endCard },
    );
    return {
      ...result,
      renderer: 'ffmpeg',
      requested: 'ffmpeg',
      generations: ['ffmpeg_vertical'],
      strategy: 'ffmpeg',
    };
  }
}

export class RevideoCompositionRenderer implements CompositionRenderer {
  readonly kind = 'revideo' as const;
  async render(input: CompositionInput): Promise<CompositionRenderResult> {
    if (config.REVIDEO_FORCE_FAIL) throw new Error('COMPOSITION_UNAVAILABLE:forced_failure');
    const wall = Date.now();
    const base = path.join(input.workDir, 'ffmpeg-timeline.mp4');
    const ffmpegStarted = Date.now();
    const timeline = await renderVertical(input.plan, base, input.captionsPath, input.voicePath, {
      logoPath: input.logoPath,
      endCard: input.endCard,
    });
    const ffmpegTimelineMs = Date.now() - ffmpegStarted;

    await bindRevideoFfmpeg();
    await patchRevideoNavigationTimeout(120_000);
    const publicRuntime = path.join(projectRoot, 'public', 'runtime');
    await mkdir(publicRuntime, { recursive: true });
    const silentWav = path.join(publicRuntime, 'silent.wav');
    await run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-t',
      String(BRANDING_END_S),
      '-ac',
      '2',
      '-ar',
      '48000',
      silentWav,
    ]);
    const { renderVideo } = await import('@revideo/renderer');
    const previousCwd = process.cwd();
    const outFile = `branding-${Date.now()}.mp4`;
    const title = sanitizeTitle(input.decision.text.title) ?? 'Casa';
    const revideoStarted = Date.now();
    let brandingPath = '';
    process.chdir(projectRoot);
    try {
      const rendered = await renderVideo({
        projectFile: './branding-project.ts',
        variables: {
          title,
          logoSrc: '/branding/logo-fixture.png',
          showLogo: true,
          cta: input.decision.text.cta ?? '',
          endCard: 'Casa',
          bedSrc: '/runtime/silent.wav',
        },
        settings: revideoRenderSettings(outFile),
      });
      brandingPath = path.isAbsolute(rendered) ? rendered : path.join(projectRoot, rendered);
    } finally {
      process.chdir(previousCwd);
    }
    const revideoMs = Date.now() - revideoStarted;
    const composed = path.join(input.workDir, 'revideo-hybrid.mp4');
    const muxStarted = Date.now();
    try {
      await muxHybrid(base, brandingPath, composed);
    } finally {
      await rm(brandingPath, { force: true });
    }
    await copyFile(composed, input.output);
    const muxMs = Date.now() - muxStarted;
    await rm(publicRuntime, { recursive: true, force: true });
    return {
      profile: timeline.profile,
      warning: timeline.warning,
      renderer: 'revideo',
      requested: 'revideo',
      generations: ['ffmpeg_timeline', 'revideo_branding', 'ffmpeg_mux'],
      layout: casaCompositionLayout,
      fixtureBranding: true,
      strategy: 'hybrid_ffmpeg_timeline_revideo_branding',
      timings: {
        ffmpegTimelineMs,
        revideoMs,
        muxMs,
        wallMs: Date.now() - wall,
      },
    };
  }
}

export async function renderComposition(
  input: CompositionInput,
  requested: 'ffmpeg' | 'revideo',
): Promise<CompositionRenderResult> {
  const ffmpeg = new FFmpegCompositionRenderer();
  if (requested !== 'revideo') return ffmpeg.render(input);
  try {
    return await new RevideoCompositionRenderer().render(input);
  } catch (error) {
    if (config.REQUIRE_REVIDEO_RENDER) throw error;
    const fallback = await ffmpeg.render(input);
    return {
      ...fallback,
      requested: 'revideo',
      renderer: 'ffmpeg',
      fallbackReason: error instanceof Error ? error.message.slice(0, 180) : 'revideo_failed',
    };
  }
}

function sanitizeTitle(value: string | null | undefined) {
  if (!value) return null;
  if (
    /experiência inesquecível|sabores que encantam|momentos únicos|desconto|promoção|r\$/i.test(
      value,
    )
  )
    return 'Casa';
  return value.slice(0, 80);
}

async function bindRevideoFfmpeg() {
  const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';
  const require = createRequire(import.meta.url);
  const revideoFfmpeg = require('@revideo/ffmpeg') as {
    ffmpegSettings: { setFfmpegPath(path: string): void; setFfprobePath(path: string): void };
    createSilentAudioFile?: (filePath: string, duration: number) => Promise<string>;
  };
  revideoFfmpeg.ffmpegSettings.setFfmpegPath(ffmpegBin);
  revideoFfmpeg.ffmpegSettings.setFfprobePath(ffprobeBin);
  const silentAudio = async (filePath: string, duration: number) => {
    await run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-t',
      String(Math.max(0.1, duration)),
      '-ac',
      '2',
      '-ar',
      '48000',
      filePath,
    ]);
    return filePath;
  };
  try {
    Object.defineProperty(revideoFfmpeg, 'createSilentAudioFile', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: silentAudio,
    });
  } catch {
    // Audio bed in the branding scene is the supported path; this is only a safety net.
  }
}

async function muxHybrid(base: string, branding: string, output: string) {
  const graph = [
    `[1:v]fps=30,setsar=1,format=yuv420p[mid]`,
    `[0:v]trim=start=0:end=${BRANDING_END_S},setpts=PTS-STARTPTS,fps=30,scale=1080:1920,setsar=1,format=yuv420p[end]`,
    `[mid][end]concat=n=2:v=1:a=0[v]`,
  ].join(';');
  try {
    await run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      branding,
      '-i',
      base,
      '-filter_complex',
      `${graph};[1:a]${deliveryAudioFilter()},apad=pad_dur=${BRANDING_END_S}[a]`,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      ...deliveryAudioEncodeArgs(),
      '-movflags',
      '+faststart',
      output,
    ]);
  } catch {
    await run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      branding,
      '-i',
      base,
      '-filter_complex',
      graph,
      '-map',
      '[v]',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      output,
    ]);
  }
}
