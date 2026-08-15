import { simulateFairDrain } from '../../packages/shared/dist/scale.js';

const tenants = 200;
const jobsPerTenant = 50;
const jobs = [];
for (let t = 0; t < tenants; t += 1) {
  for (let n = 0; n < jobsPerTenant; n += 1) {
    jobs.push({ tenantId: `t${t}`, enqueuedAt: 0 });
  }
}
const started = Date.now();
const result = simulateFairDrain({ jobs, slots: 4, maxPerTenant: 1, tickMs: 10 });
const elapsedMs = Date.now() - started;
const waits = result.completions.map((item) => item.waitMs);
const sorted = [...waits].sort((a, b) => a - b);
const pass = result.completions.length === jobs.length && elapsedMs < 20_000;
console.log(
  JSON.stringify(
    {
      pass,
      jobs: jobs.length,
      tenants,
      elapsedMs,
      completions: result.completions.length,
      p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
      ticks: result.ticks,
    },
    null,
    2,
  ),
);
process.exit(pass ? 0 : 2);
