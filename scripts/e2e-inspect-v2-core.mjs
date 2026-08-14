import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

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
  .select('id,title,status,progress,error_code,error_message,duration_seconds,metadata')
  .in('id', reelIds);
if (error) throw error;
for (const reel of data ?? []) {
  const m = reel.metadata ?? {};
  console.log(
    JSON.stringify({
      id: reel.id.slice(0, 8),
      title: reel.title,
      status: reel.status,
      progress: reel.progress,
      error: reel.error_code,
      message: reel.error_message,
      director_used: m.director_used ?? m.director_mode,
      timeline_source: m.timeline_source,
      requested: m.composition_renderer_requested,
      used: m.composition_renderer_used,
      strategy: m.composition_strategy,
      fallback: m.composition_fallback_reason,
      schema: m.video_edit_decision?.schemaVersion,
      cams: (m.video_edit_decision?.scenes ?? []).map((scene) =>
        String(scene.cameraId ?? '').slice(0, 8),
      ),
      duration: reel.duration_seconds,
      quality: m.quality_status,
      timings: m.timings
        ? {
            directorMs: m.timings.directorMs,
            ffmpegMs: m.timings.ffmpegMs,
            revideoMs: m.timings.revideoMs,
            wallMs: m.timings.wallMs,
          }
        : null,
    }),
  );
}
