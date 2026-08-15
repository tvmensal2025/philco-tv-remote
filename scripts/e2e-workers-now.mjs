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
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const now = Date.now();
const { data, error } = await sb
  .from('worker_nodes')
  .select('id,last_seen_at,metadata')
  .order('last_seen_at', { ascending: false })
  .limit(20);
if (error) {
  console.log(JSON.stringify({ error: error.message }));
  process.exit(2);
}
const staleMs = Number(env.WORKER_HEARTBEAT_STALE_MS || 90_000);
const rows = (data ?? []).map((node) => {
  const age = now - Date.parse(node.last_seen_at);
  const hostname = node.metadata?.hostname ?? null;
  let classification = 'DEAD';
  if (age < staleMs) classification = 'LIVE';
  else if (age < 30 * 60_000) classification = 'STALE';
  return {
    worker_id: node.id,
    hostname,
    last_heartbeat: node.last_seen_at,
    age_seconds: Math.round(age / 1000),
    classification,
    visionProvider: node.metadata?.visionProvider ?? null,
    vision_real: node.metadata?.vision_real ?? null,
    yolo: node.metadata?.yolo ?? node.metadata?.ENABLE_YOLO ?? null,
    metadata_keys: Object.keys(node.metadata ?? {}).sort(),
  };
});
const live = rows.filter((row) => row.classification === 'LIVE');
const report = {
  now: new Date(now).toISOString(),
  stale_ms: staleMs,
  live_count: live.length,
  live,
  all: rows,
};
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/vps-workers-now.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
