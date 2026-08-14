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
  .select('id,status,score,caption,output_path,thumbnail_path,duration_seconds,metadata')
  .in(
    'id',
    created.map((item) => item.reelId),
  );
if (error) throw error;
for (const reel of data ?? []) {
  const meta = reel.metadata ?? {};
  console.log(
    JSON.stringify({
      id: reel.id,
      status: reel.status,
      score: reel.score,
      duration: reel.duration_seconds,
      provider: meta.provider,
      model: meta.model,
      frames: meta.frames_analyzed,
      rankings: (meta.camera_rankings ?? []).map((row) => `C${row.cameraPosition}:${row.score}`),
    }),
  );
}
