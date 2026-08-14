import type { Page } from 'puppeteer';

let navigationPatched = false;

export async function patchRevideoNavigationTimeout(timeoutMs = 120_000) {
  if (navigationPatched) return;
  const puppeteer = await import('puppeteer');
  const PageCtor = (puppeteer as { Page?: { prototype: Page } }).Page;
  if (!PageCtor?.prototype?.goto) return;
  const original = PageCtor.prototype.goto;
  PageCtor.prototype.goto = function (url, options) {
    return original.call(this, url, { timeout: timeoutMs, waitUntil: 'load', ...options });
  };
  navigationPatched = true;
}

export function revideoRenderSettings(outFile: string, options?: { logProgress?: boolean }) {
  return {
    outFile,
    outDir: 'output',
    workers: 1,
    logProgress: options?.logProgress ?? false,
    projectSettings: {
      size: { x: 1080, y: 1920 },
      exporter: {
        name: '@revideo/core/ffmpeg',
        options: { format: 'mp4' as const },
      },
    },
    ffmpeg: {
      ffmpegLogLevel: 'error' as const,
      ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
      ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    },
    puppeteer: {
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--use-gl=angle',
        '--use-angle=swiftshader',
      ],
    },
    viteConfig: {
      server: { hmr: false },
    },
    viteBasePort: 9100,
  };
}
