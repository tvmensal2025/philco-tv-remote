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
const cookie = `reelops-tenant=${JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8')).tenant.id}`;
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const id = '09e221e8-fd84-4e32-a420-90612f4a0f85';
const upd = await sb.from('reels').update({ status: 'failed' }).eq('id', id);
if (upd.error) throw upd.error;
const res = await fetch(`http://127.0.0.1:3000/api/reels/${id}/action`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ action: 'retry' }),
});
console.log(JSON.stringify({ status: res.status, body: await res.json() }));
