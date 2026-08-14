import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const { reelIds } = JSON.parse(readFileSync('test-assets/e2e/v2-casa.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const deadline = Date.now() + 22 * 60_000;
const last = {};

function summary(reel) {
  const m = reel.metadata ?? {};
  const scenes = Array.isArray(m.scenes) ? m.scenes : [];
  const decision = m.video_edit_decision ?? {};
  return {
    id: reel.id.slice(0, 8),
    title: reel.title,
    status: reel.status,
    progress: reel.progress,
    error: reel.error_code ?? null,
    program: m.program ?? null,
    director_requested: m.director_requested ?? null,
    director_used: m.director_used ?? m.director_mode ?? null,
    director_fallback_reason: m.director_fallback_reason ?? null,
    timeline_source: m.timeline_source ?? null,
    schemaVersion: decision.schemaVersion ?? null,
    cameraIds: (decision.scenes ?? []).map((scene) => String(scene.cameraId ?? '').slice(0, 8)),
    recordingIds: (decision.scenes ?? []).map((scene) =>
      String(scene.recordingId ?? '').slice(0, 8),
    ),
    composition_renderer_requested: m.composition_renderer_requested ?? null,
    composition_renderer_used: m.composition_renderer_used ?? null,
    composition_fallback_reason: m.composition_fallback_reason ?? null,
    composition_strategy: m.composition_strategy ?? null,
    timelineCams: scenes.map((scene) => scene.cam),
    duration: reel.duration_seconds ?? null,
    quality: m.quality_status ?? null,
    timings: m.timings
      ? {
          directorMs: m.timings.directorMs,
          ffmpegMs: m.timings.ffmpegMs,
          revideoMs: m.timings.revideoMs,
          ffmpegTimelineMs: m.timings.ffmpegTimelineMs,
          muxMs: m.timings.muxMs,
          wallMs: m.timings.wallMs,
        }
      : null,
  };
}

while (Date.now() < deadline) {
  const { data, error } = await sb
    .from('reels')
    .select('id,title,status,progress,error_code,error_message,duration_seconds,metadata')
    .in('id', reelIds);
  if (error) throw error;
  for (const reel of data ?? []) {
    const line = `${reel.status} ${reel.progress} ${reel.error_code ?? ''}`;
    if (last[reel.id] !== line) {
      console.log(
        JSON.stringify({
          id: reel.id.slice(0, 8),
          title: reel.title,
          status: reel.status,
          progress: reel.progress,
          error: reel.error_code ?? null,
          message: reel.error_message ?? null,
        }),
      );
      last[reel.id] = line;
    }
  }
  const rows = data ?? [];
  if (
    rows.length === reelIds.length &&
    rows.every((reel) => ['ready', 'failed', 'discarded'].includes(reel.status))
  ) {
    const reports = rows.map(summary);
    writeFileSync('test-assets/e2e/v2-core-result.json', JSON.stringify(reports, null, 2));
    console.log(JSON.stringify({ done: true, reports }, null, 2));
    process.exit(rows.every((reel) => reel.status === 'ready') ? 0 : 2);
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
console.error('TIMEOUT waiting for V2 core reels');
process.exit(3);
