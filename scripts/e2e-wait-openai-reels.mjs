import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

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
const ids = created.map((item) => item.reelId).filter(Boolean);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const deadline = Date.now() + 15 * 60_000;
const last = {};

while (Date.now() < deadline) {
  const { data, error } = await sb
    .from('reels')
    .select('id,status,progress,error_code,error_message,output_path,score,metadata,caption')
    .in('id', ids);
  if (error) throw error;
  for (const reel of data ?? []) {
    const line = `${reel.status} ${reel.progress} ${reel.error_code ?? ''} ${reel.error_message ?? ''}`;
    if (last[reel.id] !== line) {
      console.log(`${reel.id.slice(0, 8)} ${line}`);
      last[reel.id] = line;
    }
  }
  const rows = data ?? [];
  if (
    rows.length === ids.length &&
    rows.every((reel) => ['ready', 'failed', 'discarded'].includes(reel.status))
  ) {
    writeFileSync('test-assets/e2e/openai-reels-result.json', JSON.stringify(rows, null, 2));
    const failed = rows.filter((reel) => reel.status !== 'ready');
    process.exit(failed.length ? 2 : 0);
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
console.error('TIMEOUT waiting for openai reels');
process.exit(3);
