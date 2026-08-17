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
const reelId = process.argv[2] || 'e6a23108-e3a0-43c7-bafd-af1085b2c082';
const { data, error } = await sb
  .from('reels')
  .select('id,status,metadata')
  .eq('id', reelId)
  .single();
if (error || !data) throw error ?? new Error('missing');
const staleAt = new Date(Date.now() - 25 * 60_000).toISOString();
const metadata = {
  ...(data.metadata ?? {}),
  last_progress_at: staleAt,
  render_from_project: false,
};
const { error: updateError } = await sb
  .from('reels')
  .update({ status: 'queued', metadata })
  .eq('id', reelId);
if (updateError) throw updateError;
console.log(JSON.stringify({ reelId, status: data.status, last_progress_at: staleAt }));
