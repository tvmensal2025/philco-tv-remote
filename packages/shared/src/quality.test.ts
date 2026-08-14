import { describe, expect, it } from 'vitest';
import { boxInSafeArea, defaultSafeArea, fitVertical1080x1920 } from './crop.js';
import { evaluateCompositionQuality, evaluateTechnicalQuality } from './quality.js';
import { classifyJobFailure, shouldRetryJob } from './job-failure.js';
import { isTenantMediaPath } from './paths.js';
import { brandFromRestaurantSettings } from './brand.js';
import { createRenderManifest } from './render-manifest.js';

describe('crop and safe area', () => {
  it('crops a landscape source instead of stretching to 9:16', () => {
    const fit = fitVertical1080x1920(1920, 1080);
    expect(fit.mode).toBe('crop');
    expect(fit.filter.startsWith('crop=')).toBe(true);
    expect(fit.filter).toContain('scale=1080:1920');
  });

  it('rejects a title sitting in the TikTok chrome', () => {
    expect(
      boxInSafeArea({ x: 40, y: 8, w: 400, h: 80 }, { width: 1080, height: 1920 }, defaultSafeArea),
    ).toBe(false);
    expect(
      boxInSafeArea(
        { x: 80, y: 280, w: 900, h: 80 },
        { width: 1080, height: 1920 },
        defaultSafeArea,
      ),
    ).toBe(true);
  });
});

describe('quality gates', () => {
  it('blocks a truncated file and a missing video stream', () => {
    expect(evaluateTechnicalQuality({ sizeBytes: 12, durationSeconds: 0 }).status).toBe('failed');
    expect(
      evaluateTechnicalQuality({
        sizeBytes: 80_000,
        durationSeconds: 8,
        video: { codec: 'h264', width: 720, height: 1280, pixFmt: 'yuv420p', fps: 30 },
      }).issues.some((issue) => issue.code === 'WIDTH'),
    ).toBe(true);
  });

  it('passes a 1080x1920 h264 delivery', () => {
    const report = evaluateTechnicalQuality(
      {
        sizeBytes: 400_000,
        durationSeconds: 12,
        video: { codec: 'h264', width: 1080, height: 1920, pixFmt: 'yuv420p', fps: 30 },
        audio: { codec: 'aac', sampleRate: 48000, channels: 2 },
      },
      { videoCodec: 'h264', pixFmt: 'yuv420p' },
    );
    expect(report.status).toBe('passed');
  });

  it('detects title overflow and missing logo', () => {
    const report = evaluateCompositionQuality({
      title: 'Casa',
      titleBox: { x: 10, y: 4, w: 1060, h: 90 },
      showLogo: true,
      logoPresent: false,
    });
    expect(report.status).toBe('failed');
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['TITLE_OVERFLOW', 'MISSING_LOGO']),
    );
  });
});

describe('failure classification', () => {
  it('retries transient infra and not schema bugs', () => {
    expect(classifyJobFailure('REDIS ECONNREFUSED')).toBe('TRANSIENT');
    expect(shouldRetryJob(classifyJobFailure('REDIS ECONNREFUSED'))).toBe(true);
    expect(classifyJobFailure('TECHNICAL_QC:EMPTY_FILE')).toBe('QUALITY_FAILURE');
    expect(shouldRetryJob(classifyJobFailure('TECHNICAL_QC:EMPTY_FILE'))).toBe(false);
    expect(classifyJobFailure('DIRECTOR_INVALID_OUTPUT')).toBe('PROVIDER_ERROR');
  });
});

describe('tenant isolation helper', () => {
  it('rejects a path that belongs to another tenant', () => {
    const a = '11111111-1111-1111-1111-111111111111';
    const b = '22222222-2222-2222-2222-222222222222';
    expect(isTenantMediaPath(`cenapronta/people/${a}/r/2026-08-14/reels/x/reel.mp4`, a)).toBe(true);
    expect(isTenantMediaPath(`cenapronta/people/${b}/r/2026-08-14/reels/x/reel.mp4`, a)).toBe(
      false,
    );
  });
});

describe('brand profile', () => {
  it('reads videoBrand from restaurant settings JSON without new columns', () => {
    const brand = brandFromRestaurantSettings({
      videoBrand: {
        personality: 'urban_burger',
        showLogo: false,
        preferredPace: 'fast',
        voiceId: 'Qrdut83w0Cr152Yb4Xn3',
      },
    });
    expect(brand.personality).toBe('urban_burger');
    expect(brand.preferredPace).toBe('fast');
    expect(brand.voiceId).toBe('Qrdut83w0Cr152Yb4Xn3');
  });
});

describe('render manifest', () => {
  it('stamps pipeline and director versions', () => {
    const manifest = createRenderManifest({
      renderId: 'reel-1',
      template: 'casa',
      visionProvider: 'openai',
      vision_real: true,
      compositionRenderer: 'ffmpeg',
      compositionRendererRequested: 'ffmpeg',
      sourceChecksums: ['abc'],
      startedAt: '2026-08-14T00:00:00.000Z',
    });
    expect(manifest.pipelineVersion).toBe('2.0');
    expect(manifest.directorSchemaVersion).toBe('1.0');
  });
});
