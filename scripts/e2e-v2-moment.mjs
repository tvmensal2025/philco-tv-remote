import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const watchRoot = path.resolve('work/nvr-watch');
const originals = [
  'C1/cam-01_20260813T134200_20260813T134300.mp4',
  'C2/cam-02_20260813T134200_20260813T134300.mp4',
  'C3/cam-03_20260813T134200_20260813T134300.mp4',
  'C4/cam-04_20260813T134200_20260813T134300.mp4',
];
const watchIntact = originals.every((rel) => existsSync(path.join(watchRoot, rel)));
const ready = await fetch('http://127.0.0.1:3000/api/ready').then((res) => res.json());
const momentRes = await fetch('http://127.0.0.1:3000/api/moments', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    cookie: `reelops-tenant=${context.tenant.id}`,
  },
  body: JSON.stringify({
    restaurantId: context.restaurant.id,
    occurredAt: '2026-08-13T16:42:35.000Z',
    beforeSeconds: 12,
    afterSeconds: 8,
    label: 'Validation Full',
    category: 'event',
    clientRequestId: randomUUID(),
  }),
});
const momentBody = await momentRes.json();
const reels = momentBody.reels ?? [];
writeFileSync(
  'test-assets/e2e/v2-casa.json',
  JSON.stringify(
    {
      watchIntact,
      ready,
      momentStatus: momentRes.status,
      moment: momentBody.moment ?? null,
      reelIds: reels.map((reel) => reel.id),
      titles: reels.map((reel) => reel.title),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      watchIntact,
      ready: ready.ready,
      momentStatus: momentRes.status,
      momentId: momentBody.moment?.id ?? null,
      reelCount: reels.length,
      titles: reels.map((reel) => reel.title),
      error: momentBody.error ?? null,
    },
    null,
    2,
  ),
);
if (!watchIntact || momentRes.status >= 400 || reels.length < 4) process.exit(2);
