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
const now = Date.now();
const { data, error, count } = await sb
  .from('worker_nodes')
  .select('id,last_seen_at,metadata', { count: 'exact' })
  .order('last_seen_at', { ascending: false });
if (error) {
  console.log(JSON.stringify({ error: error.message }));
  process.exit(2);
}
const rows = (data ?? []).map((node) => {
  const age = now - Date.parse(node.last_seen_at);
  return {
    worker_id: node.id,
    hostname: node.metadata?.hostname ?? null,
    last_heartbeat: node.last_seen_at,
    age_seconds: Math.round(age / 1000),
    classification: age < 90_000 ? 'LIVE' : age < 30 * 60_000 ? 'STALE' : 'DEAD',
    rawLifecycle: node.metadata?.rawLifecycle ?? null,
    video: node.metadata?.video ?? null,
    visionProvider: node.metadata?.visionProvider ?? null,
  };
});
console.log(
  JSON.stringify(
    {
      db_now: new Date(now).toISOString(),
      count,
      live_count: rows.filter((r) => r.classification === 'LIVE').length,
      rafael_live: rows.some(
        (r) => r.classification === 'LIVE' && /rafael/i.test(String(r.hostname)),
      ),
      rows,
    },
    null,
    2,
  ),
);
