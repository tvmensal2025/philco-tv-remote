import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}
const { reelIds } = JSON.parse(readFileSync('test-assets/e2e/v2-casa.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await sb
  .from('reels')
  .select('id,title,status,duration_seconds,metadata,restaurant_id,moment_id')
  .in('id', reelIds);
if (error) throw error;
const casa = (data ?? []).find((reel) => /casa/i.test(reel.title)) ?? data?.[0];
const m = casa.metadata ?? {};
const decision = m.video_edit_decision ?? {};
const scenes = decision.scenes ?? [];
const cameraIds = [...new Set(scenes.map((scene) => scene.cameraId).filter(Boolean))];
const recordingIds = [...new Set(scenes.map((scene) => scene.recordingId).filter(Boolean))];
const { data: cameras } = await sb
  .from('cameras')
  .select('id,position,role,restaurant_id')
  .in('id', cameraIds);
const { data: recordings } = await sb
  .from('recordings')
  .select('id,camera_id,duration_seconds,started_at,ended_at')
  .in('id', recordingIds);
const cameraSet = new Set((cameras ?? []).map((row) => row.id));
const recordingSet = new Set((recordings ?? []).map((row) => row.id));
const recordingDuration = Object.fromEntries(
  (recordings ?? []).map((row) => [row.id, Number(row.duration_seconds ?? 0)]),
);
const timeIssues = [];
for (const scene of scenes) {
  if (!(scene.sourceStartMs >= 0)) timeIssues.push('start_lt_0');
  if (!(scene.sourceEndMs > scene.sourceStartMs)) timeIssues.push('end_not_after_start');
  const durMs = (recordingDuration[scene.recordingId] || 0) * 1000;
  if (durMs > 0 && scene.sourceEndMs > durMs + 50)
    timeIssues.push(`end_beyond_duration:${scene.recordingId.slice(0, 8)}`);
}
const dump = {
  reelId: casa.id,
  momentId: casa.moment_id,
  program: decision.program ?? m.program,
  duration: decision.durationSeconds ?? casa.duration_seconds,
  editingIntensity: decision.editingIntensity ?? null,
  director_requested: m.director_requested,
  director_used: m.director_used,
  timeline_source: m.timeline_source,
  requested: m.composition_renderer_requested,
  used: m.composition_renderer_used,
  fallback: m.composition_fallback_reason,
  strategy: m.composition_strategy,
  quality: m.quality ?? { status: m.quality_status },
  timings: m.timings ?? null,
  vision: {
    provider: m.vision_provider ?? m.provider ?? null,
    model: m.vision_model ?? null,
    real: m.vision_real ?? null,
    rankings: m.camera_rankings ?? null,
  },
  yolo: {
    requested: m.yolo_requested ?? null,
    used: m.yolo_used ?? null,
    ms: m.timings?.yoloMs ?? null,
  },
  cameraIdsValid: cameraIds.every((id) => cameraSet.has(id)),
  recordingIdsValid: recordingIds.every((id) => recordingSet.has(id)),
  cameras: (cameras ?? []).map((row) => ({ id: row.id, position: row.position, role: row.role })),
  recordings: (recordings ?? []).map((row) => ({
    id: row.id,
    camera_id: row.camera_id,
    duration_seconds: row.duration_seconds,
  })),
  timeIssues,
  scenes: scenes.map((scene) => ({
    cameraId: scene.cameraId,
    recordingId: scene.recordingId,
    cameraPosition: scene.cameraPosition,
    cameraRole: scene.cameraRole,
    sceneRole: scene.sceneRole,
    shotStyle: scene.shotStyle,
    reframeStrategy: scene.reframeStrategy,
    sourceStartMs: scene.sourceStartMs,
    sourceEndMs: scene.sourceEndMs,
    zoomEvents: scene.zoomEvents ?? [],
    audioStrategy: scene.audioStrategy ?? decision.audioStrategy ?? null,
  })),
};
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/casa-decision.json', JSON.stringify(dump, null, 2));
console.log(
  JSON.stringify(
    {
      reelId: dump.reelId,
      program: dump.program,
      intensity: dump.editingIntensity,
      cameraIdsValid: dump.cameraIdsValid,
      recordingIdsValid: dump.recordingIdsValid,
      timeIssues: dump.timeIssues,
      sceneCount: dump.scenes.length,
      used: dump.used,
      timeline: dump.timeline_source,
      quality: dump.quality?.status ?? m.quality_status,
      yolo: dump.yolo,
    },
    null,
    2,
  ),
);
