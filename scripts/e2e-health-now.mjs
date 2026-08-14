import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const cookie = `reelops-tenant=${context.tenant.id}`;
const [health, ready] = await Promise.all([
  fetch('http://127.0.0.1:3000/api/health', { headers: { cookie } }),
  fetch('http://127.0.0.1:3000/api/ready'),
]);
const healthBody = await health.json();
const readyBody = await ready.json();
const report = {
  healthStatus: health.status,
  health: healthBody,
  readyStatus: ready.status,
  ready: readyBody,
};
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/health.json', JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      healthStatus: health.status,
      overall: healthBody.status ?? healthBody.error ?? null,
      checks: Object.fromEntries(
        Object.entries(healthBody.checks ?? {}).map(([k, v]) => [
          k,
          { ok: v.ok, detail: String(v.detail ?? '').slice(0, 120) },
        ]),
      ),
      ready: readyBody.ready ?? readyBody,
      readyStatus: ready.status,
    },
    null,
    2,
  ),
);
if (health.status !== 200) process.exit(2);
