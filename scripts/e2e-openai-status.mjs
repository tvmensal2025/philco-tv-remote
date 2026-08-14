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
const ids = created.map((item) => item.reelId);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await sb
  .from('reels')
  .select('id,status,progress,error_code,error_message,output_path,score')
  .in('id', ids);
if (error) throw error;
console.log(JSON.stringify(data, null, 2));
