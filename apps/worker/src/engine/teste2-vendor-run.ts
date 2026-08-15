import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReelPlan } from './planner.js';
import { renderVertical } from '../pipeline/ffmpeg.js';
import { probeMedia } from '../pipeline/probe-media.js';
import { joinedDuration } from '../pipeline/finish.js';
import { evaluateTechnicalQuality } from '@reelops/shared';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const source = 'D:\\DEV\\TESTE2.mp4';
const output = path.join(root, 'work/quality/quality-teste2-vendor.mp4');

/** 9:16 window on the LEFT of 1920×1080 — vendedor + pote de sorvete. */
const vendorCrop: [number, number, number, number] = [0, 0, 640, 1080];

const cameraId = 'e2e2e2e2-2222-4222-8222-222222222222';
const takes = [
  { offset: 120, duration: 4.2, reason: 'gancho: vendedor na barraca' },
  { offset: 127.1, duration: 4, reason: 'servico: sorvete / comida' },
  { offset: 135.94, duration: 3.6, reason: 'oficio: scoop na lata' },
  { offset: 150.71, duration: 5.4, reason: 'saida: cliente na barraca' },
];

const scenes: ReelPlan['scenes'] = takes.map((take, index) => ({
  camera_id: cameraId,
  recording_id: 'e2e2e2e2-3333-4333-8333-222222222222',
  source_recording_path: source,
  source_start_offset: take.offset,
  duration: take.duration,
  speed: 1,
  transition: index === 0 ? 'cut' : 'dissolve',
  joinDuration: index === 0 ? undefined : 0.58,
  reason: take.reason,
  position: 1,
  hasAudio: true,
  role: 'master',
  fadeIn: index === 0,
  crop: vendorCrop,
  cropTight: true,
  motion: 'none' as const,
}));

const duration = joinedDuration(
  scenes.map((scene) => ({
    duration: scene.duration,
    transition: scene.transition,
    joinDuration: scene.joinDuration,
  })),
);

const plan: ReelPlan = {
  program: 'casa',
  join: 'dissolve',
  duration,
  aspect_ratio: '9:16',
  scenes,
  audio: {
    source_recording_path: source,
    source_start_offset: 120,
    duration,
  },
  score: 76,
  detailedScores: { food: 70, action: 65, visual: 76, marketing: 40, ambience: 55 },
  reason: 'TESTE2 left-side vendor crop — food and ice cream stall',
  provider: 'openai',
};

mkdirSync(path.dirname(output), { recursive: true });
await renderVertical(plan, output, null, null, { endCard: true });
const probe = await probeMedia(output);
const technical = evaluateTechnicalQuality(probe, {
  videoCodec: 'h264',
  pixFmt: 'yuv420p',
  requireAudio: true,
});
console.log(
  JSON.stringify(
    {
      output,
      duration,
      crop: vendorCrop,
      parts: scenes.map((scene) => ({
        offset: scene.source_start_offset,
        duration: scene.duration,
        reason: scene.reason,
      })),
      audio: probe.audio ?? null,
      technicalQc: technical.status,
      technicalIssues: technical.issues,
    },
    null,
    2,
  ),
);
process.exit(0);
