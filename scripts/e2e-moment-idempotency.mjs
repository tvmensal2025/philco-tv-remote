import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ctx = JSON.parse(readFileSync('test-assets/e2e/v2-casa.json', 'utf8'));
const tenant = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8')).tenant.id;
const clientRequestId = ctx.moment.client_request_id;
const restaurantId = ctx.moment.restaurant_id;
const body = {
  restaurantId,
  occurredAt: '2026-08-13T16:42:35.000Z',
  beforeSeconds: 12,
  afterSeconds: 8,
  label: 'Validation Full',
  category: 'event',
  clientRequestId,
};

async function post() {
  const res = await fetch('http://127.0.0.1:3000/api/moments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `reelops-tenant=${tenant}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const a = await post();
const b = await post();
const report = {
  statusA: a.status,
  statusB: b.status,
  duplicate: b.json.duplicate === true,
  momentA: a.json.moment?.id ?? null,
  momentB: b.json.moment?.id ?? null,
  reelsA: (a.json.reels ?? []).length,
  reelsB: (b.json.reels ?? []).length,
  sameMoment: a.json.moment?.id === b.json.moment?.id,
  expectedMoment: ctx.moment.id,
  pass:
    [200, 202].includes(a.status) &&
    [200, 202].includes(b.status) &&
    a.json.moment?.id === b.json.moment?.id &&
    (b.json.reels ?? []).length === 4,
};
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/moment-idempotency.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(2);
