import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const id = process.argv[2];
const { data, error } = await sb
  .from('reels')
  .select('id,title,status,progress,output_path,error_code,metadata')
  .eq('id', id)
  .single();
if (error) {
  console.log(JSON.stringify({ error: error.message }));
  process.exit(2);
}
const meta = data.metadata ?? {};
console.log(
  JSON.stringify(
    {
      id: data.id,
      title: data.title,
      status: data.status,
      output_path: data.output_path,
      metadata_keys: Object.keys(meta).sort(),
      director_requested: meta.director_requested ?? null,
      director_used: meta.director_used ?? null,
      director_fallback: meta.director_fallback ?? null,
      timeline_source: meta.timeline_source ?? null,
      composition_renderer_requested: meta.composition_renderer_requested ?? null,
      composition_renderer_used: meta.composition_renderer_used ?? null,
      composition_fallback: meta.composition_fallback ?? null,
      composition_strategy: meta.composition_strategy ?? null,
      vision_provider: meta.vision_provider ?? meta.provider ?? null,
      vision_model: meta.model ?? null,
      vision_real: meta.vision_real ?? null,
      recovery_count: meta.recovery_count ?? 0,
      recovery_action: meta.recovery_action ?? null,
      logical_job_id: meta.logical_job_id ?? null,
      execution_id: meta.execution_id ?? null,
      last_progress_at: meta.last_progress_at ?? null,
      owner_worker_id: meta.owner_worker_id ?? null,
      quality_status: meta.quality_status ?? null,
      visual_qc: meta.visual_qc ?? null,
      timings: meta.timings ?? null,
      sourceAudio: meta.sourceAudio ?? null,
      pipeline_version: meta.pipeline_version ?? null,
    },
    null,
    2,
  ),
);
