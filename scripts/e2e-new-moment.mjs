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
const res = await fetch('http://127.0.0.1:3000/api/moments', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    restaurantId: context.restaurant.id,
    occurredAt: '2026-08-13T16:42:30.000Z',
    beforeSeconds: 25,
    afterSeconds: 25,
    label: 'E2E publico 4 cameras retry',
    category: 'preparation',
  }),
});
const body = await res.json();
writeFileSync('test-assets/e2e/moment.json', JSON.stringify({ status: res.status, body }, null, 2));
console.log(JSON.stringify({ status: res.status, reelId: body.reel?.id, error: body.error }));
