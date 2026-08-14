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
const { created } = JSON.parse(readFileSync('test-assets/e2e/openai-reels.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await sb
  .from('reels')
  .select('id,status')
  .in(
    'id',
    created.map((item) => item.reelId),
  );
if (error) throw error;
const pending = (data ?? []).filter((reel) => reel.status !== 'ready');
for (const reel of pending) {
  if (reel.status !== 'failed') {
    await sb
      .from('reels')
      .update({
        status: 'failed',
        error_code: 'RETRY_OPENAI',
        error_message: 'Reprocessar com OpenAI',
      })
      .eq('id', reel.id);
  }
  const res = await fetch(`http://127.0.0.1:3000/api/reels/${reel.id}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'retry' }),
  });
  console.log(
    JSON.stringify({ id: reel.id, from: reel.status, retry: res.status, body: await res.json() }),
  );
}
if (!pending.length) console.log(JSON.stringify({ ok: true, pending: 0 }));
