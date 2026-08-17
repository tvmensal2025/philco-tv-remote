import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from 'minio';
import { createClient } from '@supabase/supabase-js';
import { calendarDay, reelRenderPrefix } from '@reelops/shared';
import type { ClipCandidate } from '../adapters/analyzer.js';
import { compileProgram } from './planner.js';
import { coverageReport } from './coverage.js';
import { playbookFor } from './playbook.js';
import type { PeakHit } from './peak-snap.js';
import { renderVertical, run } from '../pipeline/ffmpeg.js';
import { probeMedia } from '../pipeline/probe-media.js';
import { config } from '../config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const dir = path.join(root, 'work/validation/stock-three');
const outDir = path.join(dir, 'programs');
mkdirSync(outDir, { recursive: true });

const kitchen = path.join(dir, 'oficio.padded.mp4');
const pizza = path.join(dir, 'assinatura.padded.mp4');
const dining = path.join(dir, 'casa.padded.mp4');
for (const file of [kitchen, pizza, dining]) {
  if (!existsSync(file)) throw new Error(`MISSING:${file}`);
}

function clip(
  file: string,
  position: number,
  role: ClipCandidate['role'],
  id: string,
): ClipCandidate {
  return {
    cameraId: id,
    recordingId: `rec-${id}`,
    path: file,
    localPath: file.replaceAll('\\', '/'),
    position,
    startOffsetSeconds: 1,
    windowDurationSeconds: 46,
    hasAudio: false,
    role,
  };
}

function peaks(cameraId: string): [string, PeakHit[]] {
  return [
    cameraId,
    [4, 10, 16, 22, 28, 34, 40].map((offsetSeconds, index) => ({
      offsetSeconds,
      fusedScore: 92 - index * 4,
    })),
  ];
}

const kitchenMaster = clip(kitchen, 1, 'master', 'mix-master');
const kitchenSide = clip(kitchen, 2, 'side', 'mix-side');
const pizzaFood = clip(pizza, 3, 'food', 'mix-food');
const diningMaster = clip(dining, 1, 'master', 'mix-dining');

const jobs = [
  {
    program: 'casa' as const,
    title: 'Mixkit salão · Casa (local; juiz recusaria palco)',
    clips: [diningMaster],
  },
  {
    program: 'oficio' as const,
    title: 'Mixkit cozinha · Ofício (local planner)',
    clips: [kitchenMaster, kitchenSide, pizzaFood],
  },
  {
    program: 'assinatura' as const,
    title: 'Mixkit prato · Assinatura (local planner)',
    clips: [kitchenMaster, kitchenSide, pizzaFood],
  },
];

const rendered = [];
for (const job of jobs) {
  const peaksByCamera = new Map(job.clips.map((item) => peaks(item.cameraId)));
  const plan = compileProgram({
    clips: job.clips,
    program: job.program,
    peaksByCamera,
  });
  const coverage = coverageReport(
    playbookFor(job.program),
    plan.scenes.map((scene) => ({
      role: scene.role,
      duration: scene.duration,
      cameraId: scene.camera_id,
    })),
  );
  if (!coverage.ok) throw new Error(`${job.program}:${coverage.reason}`);
  const output = path.join(outDir, `${job.program}.mp4`);
  const thumb = path.join(outDir, `${job.program}.jpg`);
  console.log(JSON.stringify({ step: 'render', program: job.program, scenes: plan.scenes.length }));
  await renderVertical(plan, output, null, null, { endCard: true });
  await run('ffmpeg', ['-y', '-ss', '1.5', '-i', output, '-frames:v', '1', '-q:v', '4', thumb]);
  const probe = await probeMedia(output);
  rendered.push({
    ...job,
    output,
    thumb,
    duration: probe.durationSeconds ?? plan.duration,
    scenes: plan.scenes.map((scene) => ({
      role: scene.role,
      offset: scene.source_start_offset,
      duration: scene.duration,
    })),
    coverage: coverage.reason,
  });
}

const context = JSON.parse(readFileSync(path.join(root, 'test-assets/e2e/context.json'), 'utf8'));
const sb = createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const minio = new Client({
  endPoint: config.MINIO_ENDPOINT,
  port: config.MINIO_PORT,
  useSSL: config.MINIO_USE_SSL,
  accessKey: config.MINIO_ACCESS_KEY,
  secretKey: config.MINIO_SECRET_KEY,
});

const published = [];
for (const job of rendered) {
  const reelId = randomUUID();
  const momentId = randomUUID();
  const now = new Date();
  const day = calendarDay(now);
  const prefix = reelRenderPrefix(context.tenant.id, context.restaurant.id, day, reelId);
  const videoKey = `${prefix}/reel.mp4`;
  const thumbKey = `${prefix}/thumbnail.jpg`;
  await minio.fPutObject(config.MINIO_BUCKET, videoKey, job.output, {
    'Content-Type': 'video/mp4',
  });
  await minio.fPutObject(config.MINIO_BUCKET, thumbKey, job.thumb, {
    'Content-Type': 'image/jpeg',
  });
  const { error: momentError } = await sb.from('moments').insert({
    id: momentId,
    tenant_id: context.tenant.id,
    restaurant_id: context.restaurant.id,
    type: 'manual',
    occurred_at: now.toISOString(),
    window_start: now.toISOString(),
    window_end: now.toISOString(),
    label: job.title,
    category: 'event',
    priority_score: 80,
    client_request_id: randomUUID(),
  });
  if (momentError) throw momentError;
  const { error: reelError } = await sb.from('reels').insert({
    id: reelId,
    tenant_id: context.tenant.id,
    restaurant_id: context.restaurant.id,
    moment_id: momentId,
    title: job.title,
    status: 'ready',
    progress: 100,
    duration_seconds: job.duration,
    output_path: videoKey,
    thumbnail_path: thumbKey,
    metadata: {
      program: job.program,
      source: 'mixkit-local-planner',
      note:
        job.program === 'casa'
          ? 'Corte local do salão. O VPS recusou: Casa é palco, não jantar.'
          : 'Planner local. O VPS pulou por cobertura/câmeras misturadas.',
      scenes: job.scenes,
      vps: false,
    },
  });
  if (reelError) throw reelError;
  published.push({
    program: job.program,
    reelId,
    watch: `http://localhost:3000/reels/${reelId}`,
    file: job.output,
    duration: job.duration,
  });
}

const report = { pass: true, published };
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
