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
const ids = [
  '5aec215d-b561-4586-9cb2-50188ab84d6c',
  'f4842884-08c6-4212-9a63-af99c4e32fe4',
  '3c9f4709-ef0b-4357-9e6a-8ad4fb464b08',
];
const { data, error } = await sb
  .from('reels')
  .update({ status: 'discarded' })
  .in('id', ids)
  .select('id,title,status');
if (error) throw error;
console.log(JSON.stringify(data));
