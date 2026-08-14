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
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: recordings, error } = await sb
  .from('recordings')
  .select('id,camera_id,object_key,started_at,ended_at,duration_seconds,size_bytes,checksum')
  .eq('restaurant_id', context.restaurant.id)
  .gte('started_at', '2026-08-13T16:40:00.000Z')
  .lte('started_at', '2026-08-13T16:45:00.000Z')
  .order('started_at');
if (error) {
  const retry = await sb
    .from('recordings')
    .select('id,camera_id,object_key,started_at,ended_at,duration_seconds,size_bytes')
    .eq('restaurant_id', context.restaurant.id)
    .gte('started_at', '2026-08-13T16:40:00.000Z')
    .order('started_at');
  if (retry.error) throw retry.error;
  console.log(JSON.stringify({ recordings: retry.data, checksumColumn: false }, null, 2));
  writeFileSync('test-assets/e2e/recordings.json', JSON.stringify(retry.data, null, 2));
} else {
  console.log(
    JSON.stringify({ recordings, checksumColumn: true, count: recordings?.length }, null, 2),
  );
  writeFileSync('test-assets/e2e/recordings.json', JSON.stringify(recordings, null, 2));
}

const res = await fetch('http://127.0.0.1:3000/api/moments', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    restaurantId: context.restaurant.id,
    occurredAt: '2026-08-13T16:42:30.000Z',
    beforeSeconds: 25,
    afterSeconds: 25,
    label: 'E2E publico 4 cameras',
    category: 'preparation',
  }),
});
const body = await res.json();
writeFileSync('test-assets/e2e/moment.json', JSON.stringify({ status: res.status, body }, null, 2));
console.log(
  JSON.stringify(
    {
      momentStatus: res.status,
      reelId: body.reel?.id,
      momentId: body.moment?.id,
      error: body.error,
      window: { start: body.moment?.window_start, end: body.moment?.window_end },
    },
    null,
    2,
  ),
);
