import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { decisionFromReelPlan } from '../engine/director.js';
import { renderComposition } from './composition.js';
import type { ReelPlan } from '../engine/planner.js';

const source = [
  path.resolve('test-assets/e2e/cam-01.mp4'),
  path.resolve('../../test-assets/e2e/cam-01.mp4'),
].find((candidate) => existsSync(candidate));
if (!source) throw new Error('missing cam-01 fixture');

describe('Revideo → FFmpeg fallback', () => {
  it('produces a valid MP4 when Revideo is forced to fail', async () => {
    const previousFail = config.REVIDEO_FORCE_FAIL;
    const previousRequire = config.REQUIRE_REVIDEO_RENDER;
    config.REVIDEO_FORCE_FAIL = true;
    config.REQUIRE_REVIDEO_RENDER = false;
    const dir = await mkdtemp(path.join(tmpdir(), 'revideo-fallback-'));
    const output = path.join(dir, 'reel.mp4');
    try {
      await mkdir(dir, { recursive: true });
      const plan: ReelPlan = {
        program: 'casa',
        join: 'cut',
        duration: 2,
        aspect_ratio: '9:16',
        scenes: [
          {
            camera_id: 'cam-1',
            source_recording_path: source,
            source_start_offset: 1,
            duration: 2,
            speed: 1,
            transition: 'cut',
            reason: 'fallback fixture',
            position: 1,
            hasAudio: true,
            role: 'ambience',
          },
        ],
        audio: { source_recording_path: source, source_start_offset: 1, duration: 2 },
        score: 70,
        detailedScores: { food: 50, action: 50, visual: 60, marketing: 50, ambience: 70 },
        reason: 'fallback fixture',
        provider: 'openai',
        caption: 'Café da casa',
      };
      const decision = decisionFromReelPlan(plan, {
        tenantId: '11111111-1111-1111-1111-111111111111',
        restaurantId: '22222222-2222-2222-2222-222222222222',
        momentId: '33333333-3333-3333-3333-333333333333',
        reelId: '44444444-4444-4444-4444-444444444444',
      });
      const result = await renderComposition({ plan, decision, output, workDir: dir }, 'revideo');
      expect(result.requested).toBe('revideo');
      expect(result.renderer).toBe('ffmpeg');
      expect(result.fallbackReason).toMatch(/forced_failure|COMPOSITION_UNAVAILABLE/);
    } finally {
      config.REVIDEO_FORCE_FAIL = previousFail;
      config.REQUIRE_REVIDEO_RENDER = previousRequire;
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('does not fall back when REQUIRE_REVIDEO_RENDER is on', async () => {
    const previousFail = config.REVIDEO_FORCE_FAIL;
    const previousRequire = config.REQUIRE_REVIDEO_RENDER;
    config.REVIDEO_FORCE_FAIL = true;
    config.REQUIRE_REVIDEO_RENDER = true;
    const dir = await mkdtemp(path.join(tmpdir(), 'revideo-require-'));
    const output = path.join(dir, 'reel.mp4');
    try {
      const plan: ReelPlan = {
        program: 'casa',
        join: 'cut',
        duration: 2,
        aspect_ratio: '9:16',
        scenes: [
          {
            camera_id: 'cam-1',
            source_recording_path: source,
            source_start_offset: 1,
            duration: 2,
            speed: 1,
            transition: 'cut',
            reason: 'require fixture',
            position: 1,
            hasAudio: true,
            role: 'ambience',
          },
        ],
        score: 70,
        detailedScores: { food: 50, action: 50, visual: 60, marketing: 50, ambience: 70 },
        reason: 'require fixture',
        provider: 'openai',
      };
      const decision = decisionFromReelPlan(plan, {
        tenantId: '11111111-1111-1111-1111-111111111111',
        restaurantId: '22222222-2222-2222-2222-222222222222',
        momentId: '33333333-3333-3333-3333-333333333333',
        reelId: '44444444-4444-4444-4444-444444444444',
      });
      await expect(
        renderComposition({ plan, decision, output, workDir: dir }, 'revideo'),
      ).rejects.toThrow(/COMPOSITION_UNAVAILABLE/);
    } finally {
      config.REVIDEO_FORCE_FAIL = previousFail;
      config.REQUIRE_REVIDEO_RENDER = previousRequire;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
