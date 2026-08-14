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
const { reelIds } = JSON.parse(readFileSync('test-assets/e2e/four-programs.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const deadline = Date.now() + 20 * 60_000;
const last = {};

while (Date.now() < deadline) {
  const { data, error } = await sb
    .from('reels')
    .select('id,title,status,progress,error_code,error_message,output_path,score,metadata')
    .in('id', reelIds);
  if (error) throw error;
  for (const reel of data ?? []) {
    const program = reel.metadata?.program ?? '?';
    const line = `${reel.status} ${reel.progress} ${program} ${reel.error_code ?? ''} ${reel.error_message ?? ''}`;
    if (last[reel.id] !== line) {
      console.log(`${reel.id.slice(0, 8)} ${reel.title} ${line}`);
      last[reel.id] = line;
    }
  }
  const rows = data ?? [];
  if (
    rows.length === reelIds.length &&
    rows.every((reel) => ['ready', 'failed', 'discarded'].includes(reel.status))
  ) {
    writeFileSync('test-assets/e2e/four-programs-result.json', JSON.stringify(rows, null, 2));
    const failed = rows.filter((reel) => reel.status !== 'ready');
    process.exit(failed.length ? 2 : 0);
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
console.error('TIMEOUT waiting for four-program reels');
process.exit(3);
