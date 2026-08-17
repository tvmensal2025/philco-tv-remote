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
const { data } = await sb.from('worker_nodes').select('id,metadata,last_seen_at');
const rafael = (data ?? []).filter((node) =>
  /rafael/i.test(String(node.metadata?.hostname ?? node.id)),
);
const stale = new Date(Date.now() - 3 * 60_000).toISOString();
for (const node of rafael) {
  await sb.from('worker_nodes').update({ last_seen_at: stale }).eq('id', node.id);
  console.log(JSON.stringify({ aged: node.id, stale }));
}
