import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const momentId = process.argv[2] || 'b3685c8d-92e8-4192-9940-d041767560b9';
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: liveNodes, error: liveError } = await sb
  .from('worker_nodes')
  .select('id,last_seen_at,metadata')
  .order('last_seen_at', { ascending: false })
  .limit(8);
if (liveError) throw liveError;
const now = Date.now();
const live = (liveNodes ?? []).filter((node) => now - Date.parse(node.last_seen_at) < 90_000);
const vps = live.find((node) => !/rafael/i.test(String(node.metadata?.hostname ?? node.id)));
if (live.length !== 1 || !vps) {
  console.log(JSON.stringify({ pass: false, gate: 'LIVE_WORKER', live }));
  process.exit(2);
}

const { data: moment, error: momentError } = await sb
  .from('moments')
  .select('id,tenant_id,restaurant_id')
  .eq('id', momentId)
  .single();
if (momentError || !moment) throw momentError ?? new Error('moment missing');

const staleAt = new Date(Date.now() - 25 * 60_000).toISOString();
const { data: reel, error: reelError } = await sb
  .from('reels')
  .insert({
    tenant_id: moment.tenant_id ?? context.tenant.id,
    restaurant_id: moment.restaurant_id ?? context.restaurant.id,
    moment_id: moment.id,
    title: 'TESTE5 Bem Assados · Casa recorte',
    status: 'queued',
    progress: 0,
    metadata: {
      program: 'casa',
      last_progress_at: staleAt,
      source: 'teste5-recut',
      render_from_project: false,
    },
  })
  .select('id')
  .single();
if (reelError) throw reelError;

await sb.from('job_events').insert({
  tenant_id: moment.tenant_id ?? context.tenant.id,
  reel_id: reel.id,
  status: 'queued',
  message: 'Casa TESTE5 recorte sem video_project',
});

const report = {
  step: 'queued',
  moment_id: moment.id,
  casa_id: reel.id,
  watch: `http://127.0.0.1:3000/reels/${reel.id}`,
  expected_worker: vps.id,
};
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/teste5-recut.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const deadline = Date.now() + 35 * 60_000;
let last = '';
let finalRow = null;
while (Date.now() < deadline) {
  const { data, error } = await sb
    .from('reels')
    .select('id,status,progress,error_code,error_message,duration_seconds,updated_at,metadata')
    .eq('id', reel.id)
    .single();
  if (error) throw error;
  const line = `${data.status} ${data.progress} ${data.error_code ?? ''} ${data.metadata?.owner_worker_id ?? ''} ${data.metadata?.recovery_action ?? ''}`;
  if (line !== last) {
    console.log(line);
    last = line;
  }
  if (['ready', 'failed', 'discarded'].includes(data.status)) {
    finalRow = data;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 8000));
}

const meta = finalRow?.metadata ?? {};
const transitions = Array.isArray(meta.house_cut)
  ? meta.house_cut.slice(1).map((take) => take.transition)
  : [];
const result = {
  pass:
    finalRow?.status === 'ready' &&
    Boolean(meta.house_cut) &&
    Boolean(meta.video_project) &&
    Boolean(meta.music_bed) &&
    !transitions.includes('fadeblack') &&
    String(meta.owner_worker_id ?? '').startsWith(String(vps.id).split('-')[0]),
  casa_id: reel.id,
  moment_id: moment.id,
  status: finalRow?.status ?? 'timeout',
  progress: finalRow?.progress ?? null,
  duration_seconds: finalRow?.duration_seconds ?? null,
  error_code: finalRow?.error_code ?? null,
  error_message: finalRow?.error_message ?? null,
  owner_worker_id: meta.owner_worker_id ?? null,
  expected_worker: vps.id,
  house_cut: meta.house_cut ?? [],
  join: meta.join ?? null,
  transitions,
  music_bed: meta.music_bed ?? null,
  director_used: meta.director_used ?? null,
  watch: `http://127.0.0.1:3000/reels/${reel.id}`,
};
writeFileSync('work/validation/teste5-recut.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 2);
