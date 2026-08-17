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
const { data, error } = await sb
  .from('platform_program_presets')
  .select('program,status,spec')
  .eq('status', 'published');
if (error) {
  console.log(JSON.stringify({ error: error.message }));
  process.exit(1);
}
for (const row of data ?? []) {
  const beats = row.spec?.beats ?? [];
  console.log(
    JSON.stringify({
      program: row.program,
      target: row.spec?.targetDuration,
      n: beats.length,
      joins: [...new Set(beats.map((beat) => beat.join))],
      punch: beats.some((beat) => beat.punchIn),
      durs: beats.map((beat) => beat.durationSeconds),
    }),
  );
}
if (!data?.length) console.log(JSON.stringify({ published: [] }));
