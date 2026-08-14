import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}
const { reelIds } = JSON.parse(readFileSync('test-assets/e2e/core-stabilize.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await sb
  .from('reels')
  .select('id,title,status,metadata,duration_seconds')
  .in('id', reelIds);
if (error) throw error;
for (const reel of data ?? []) {
  const m = reel.metadata ?? {};
  console.log(
    JSON.stringify({
      id: reel.id.slice(0, 8),
      program: m.program,
      status: reel.status,
      quality_status: m.quality_status ?? null,
      pipeline_version: m.pipeline_version ?? null,
      director_mode: m.director_mode ?? null,
      provider: m.provider,
      model: m.model,
      vision_real: m.vision_real,
      render_profile_requested: m.render_profile_requested,
      render_profile_used: m.render_profile_used,
      render_fallback_reason: m.render_fallback_reason,
      composition_renderer_used: m.composition_renderer_used,
      hasDecision: Boolean(m.video_edit_decision?.schemaVersion),
      decisionScenes: m.video_edit_decision?.scenes?.length ?? 0,
      hasManifest: Boolean(m.render_manifest?.pipelineVersion),
      technical: m.render_manifest?.quality?.technical?.status ?? null,
      composition: m.render_manifest?.quality?.composition?.status ?? null,
      timings: m.timings ?? null,
    }),
  );
}
