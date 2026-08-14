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
const { reelIds } = JSON.parse(readFileSync('test-assets/e2e/v2-casa.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const deadline = Date.now() + 25 * 60 * 1000;
let last = [];
while (Date.now() < deadline) {
  const { data, error } = await sb
    .from('reels')
    .select('id,title,status,duration_seconds,metadata')
    .in('id', reelIds);
  if (error) throw error;
  last = data ?? [];
  const summary = last.map((reel) => ({
    id: reel.id.slice(0, 8),
    title: reel.title,
    status: reel.status,
    program: reel.metadata?.program,
    director: reel.metadata?.director_mode,
    requested: reel.metadata?.composition_renderer_requested,
    used: reel.metadata?.composition_renderer_used,
    fallback: reel.metadata?.composition_fallback_reason ?? null,
    quality: reel.metadata?.quality_status,
    vision: reel.metadata?.provider,
    real: reel.metadata?.vision_real,
  }));
  console.log(
    JSON.stringify({
      t: Math.round((Date.now() - (deadline - 25 * 60 * 1000)) / 1000),
      reels: summary,
    }),
  );
  const terminal = last.every((reel) => ['ready', 'failed', 'discarded'].includes(reel.status));
  if (terminal) break;
  await new Promise((resolve) => setTimeout(resolve, 15000));
}
writeFileSync('work/revideo-evidence/v2-reels.json', JSON.stringify(last, null, 2));
const casa = last.find((reel) => reel.metadata?.program === 'casa');
const pass =
  last.filter((reel) => reel.status === 'ready').length === 4 &&
  casa?.metadata?.composition_renderer_used === 'revideo' &&
  casa?.metadata?.director_mode === 'ai' &&
  casa?.metadata?.vision_real === true &&
  casa?.metadata?.quality_status === 'passed';
console.log(
  JSON.stringify(
    {
      pass,
      casaRenderer: casa?.metadata?.composition_renderer_used,
      director: casa?.metadata?.director_mode,
      statuses: last.map((reel) => reel.status),
    },
    null,
    2,
  ),
);
if (!pass) process.exit(2);
