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
const roles = { 1: 'master', 2: 'side', 3: 'food', 4: 'ambience' };
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

for (const camera of context.cameras) {
  const { error } = await sb
    .from('cameras')
    .update({
      source_config: { role: roles[camera.position] },
    })
    .eq('id', camera.id)
    .eq('tenant_id', context.tenant.id);
  if (error) console.log('camera role skip', camera.position, error.message);
}

const ready = await fetch('http://127.0.0.1:3000/api/ready')
  .then((res) => res.json())
  .catch((error) => ({ error: String(error) }));
if (!ready.ready) {
  console.error(JSON.stringify({ ready }));
  process.exit(2);
}

const res = await fetch('http://127.0.0.1:3000/api/moments', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    cookie: `reelops-tenant=${context.tenant.id}`,
  },
  body: JSON.stringify({
    restaurantId: context.restaurant.id,
    occurredAt: '2026-08-13T16:42:30.000Z',
    beforeSeconds: 12,
    afterSeconds: 8,
    label: 'E2E finishing',
    category: 'event',
  }),
});
const body = await res.json();
const reels = body.reels ?? (body.reel ? [body.reel] : []);
writeFileSync(
  'test-assets/e2e/four-programs.json',
  JSON.stringify({ status: res.status, body, reelIds: reels.map((reel) => reel.id) }, null, 2),
);
console.log(
  JSON.stringify(
    {
      momentStatus: res.status,
      momentId: body.moment?.id ?? null,
      reelCount: reels.length,
      titles: reels.map((reel) => reel.title),
      error: body.error ?? null,
    },
    null,
    2,
  ),
);
if (res.status >= 400 || reels.length < 1) process.exit(2);
