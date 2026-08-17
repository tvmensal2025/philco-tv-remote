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
const id = process.argv[2] || '9eac3bcc-5c69-4117-a76b-5d277c97c7d8';
const { data: reel, error } = await sb
  .from('reels')
  .select('id,status,error_code,error_message,duration_seconds,caption,metadata,updated_at')
  .eq('id', id)
  .single();
if (error) throw error;
const m = reel.metadata ?? {};
const { data: events } = await sb
  .from('job_events')
  .select('status,message,created_at,metadata')
  .eq('reel_id', id)
  .order('created_at', { ascending: true });

console.log(
  JSON.stringify(
    {
      id: reel.id,
      status: reel.status,
      error_code: reel.error_code,
      error_message: reel.error_message,
      owner: m.owner_worker_id,
      release_stamp: m.release_stamp ?? null,
      worker: m.worker ?? null,
      takeJudgeMs: m.timings?.takeJudgeMs ?? null,
      hubScoutMs: m.timings?.hubScoutMs ?? null,
      take_judge: m.take_judge ?? null,
      hub_scout: m.hub_scout ?? null,
      metaKeys: Object.keys(m),
      scenes: m.scenes ?? null,
      house_cut: m.house_cut ?? null,
      timings: m.timings ?? null,
      camera_rankings: m.camera_rankings ?? null,
      analysis: typeof m.analysis === 'string' ? m.analysis.slice(0, 400) : m.analysis,
      events: (events ?? []).map((e) => ({
        status: e.status,
        message: e.message,
        at: e.created_at,
      })),
    },
    null,
    2,
  ),
);
