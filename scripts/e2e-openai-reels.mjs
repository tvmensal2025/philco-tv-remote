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
const stamps = [
  '2026-08-13T16:42:18.000Z',
  '2026-08-13T16:42:22.000Z',
  '2026-08-13T16:42:26.000Z',
  '2026-08-13T16:42:30.000Z',
];

const created = [];
for (const [index, occurredAt] of stamps.entries()) {
  const res = await fetch('http://127.0.0.1:3000/api/moments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      restaurantId: context.restaurant.id,
      occurredAt,
      beforeSeconds: 12,
      afterSeconds: 8,
      label: `E2E OpenAI ${index + 1}/4`,
      category: 'preparation',
    }),
  });
  const body = await res.json();
  created.push({
    index: index + 1,
    status: res.status,
    reelId: body.reel?.id ?? null,
    momentId: body.moment?.id ?? null,
    error: body.error ?? null,
    windowStart: body.moment?.window_start ?? null,
    windowEnd: body.moment?.window_end ?? null,
  });
  if (res.status === 429) break;
}

writeFileSync('test-assets/e2e/openai-reels.json', JSON.stringify({ created }, null, 2));
console.log(JSON.stringify({ created }, null, 2));
if (created.some((item) => !item.reelId)) process.exit(2);
