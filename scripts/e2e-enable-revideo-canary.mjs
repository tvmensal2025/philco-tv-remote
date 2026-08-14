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
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await sb
  .from('restaurants')
  .select('id,settings')
  .eq('id', context.restaurant.id)
  .single();
if (error) throw error;
const settings = { ...(data.settings ?? {}), enableRevideo: true };
const upd = await sb.from('restaurants').update({ settings }).eq('id', context.restaurant.id);
if (upd.error) throw upd.error;
console.log(JSON.stringify({ restaurantId: context.restaurant.id, enableRevideo: true }));
