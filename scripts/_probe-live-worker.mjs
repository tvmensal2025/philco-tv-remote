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
const { data, error } = await sb
  .from('worker_nodes')
  .select('id,last_seen_at,metadata')
  .order('last_seen_at', { ascending: false })
  .limit(3);
if (error) throw error;
const now = Date.now();
for (const node of data ?? []) {
  const age = now - Date.parse(node.last_seen_at);
  if (age > 90_000) continue;
  const m = node.metadata ?? {};
  console.log(
    JSON.stringify({
      id: node.id,
      hostname: m.hostname,
      startedAt: m.startedAt,
      version: m.version,
      pipelineVersion: m.pipelineVersion,
      releaseStamp: m.releaseStamp ?? null,
      gitSha: m.gitSha ?? null,
      renderProfile: m.renderProfile,
      last_seen_at: node.last_seen_at,
    }),
  );
}
