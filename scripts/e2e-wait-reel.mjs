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
const moment = JSON.parse(readFileSync('test-assets/e2e/moment.json', 'utf8'));
const reelId = moment.body.reel.id;
const tenantId = moment.body.reel.tenant_id;
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const deadline = Date.now() + 8 * 60_000;
let last = '';
while (Date.now() < deadline) {
  const { data, error } = await sb
    .from('reels')
    .select(
      'id,status,progress,error_code,error_message,output_path,thumbnail_path,duration_seconds,score,metadata,caption',
    )
    .eq('id', reelId)
    .single();
  if (error) throw error;
  const line = `${data.status} ${data.progress} ${data.error_code ?? ''} ${data.error_message ?? ''}`;
  if (line !== last) {
    console.log(line);
    last = line;
  }
  if (['ready', 'failed', 'discarded'].includes(data.status)) {
    writeFileSync('test-assets/e2e/reel.json', JSON.stringify(data, null, 2));
    process.exit(data.status === 'ready' ? 0 : 2);
  }
  await new Promise((resolve) => setTimeout(resolve, 4000));
}
console.error('TIMEOUT waiting for reel');
process.exit(3);
