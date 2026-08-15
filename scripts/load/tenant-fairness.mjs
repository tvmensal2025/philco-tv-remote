import {
  MemoryCounterStore,
  acquireTenantSlot,
  simulateFairDrain,
} from '../../packages/shared/dist/scale.js';

const flood = Array.from({ length: 500 }, () => ({ tenantId: 'A', enqueuedAt: 0 }));
const others = Array.from({ length: 100 }, (_, index) => ({
  tenantId: `t${index}`,
  enqueuedAt: 0,
}));
const started = Date.now();
const result = simulateFairDrain({
  jobs: [...flood, ...others],
  slots: 2,
  maxPerTenant: 1,
  tickMs: 1000,
});
const elapsedMs = Date.now() - started;
const small = result.byTenant.t0;
const noisy = result.byTenant.A;
const pass = Boolean(small && noisy && small.mean < noisy.mean && small.max <= noisy.max);
const store = new MemoryCounterStore();
const first = await acquireTenantSlot(store, 'A', 'render', 1);
const second = await acquireTenantSlot(store, 'A', 'render', 1);
console.log(
  JSON.stringify(
    {
      pass,
      elapsedMs,
      jobs: 600,
      noisy: { count: noisy?.count, mean: noisy?.mean, max: noisy?.max },
      small: { count: small?.count, mean: small?.mean, max: small?.max },
      slotCap: { first: first.ok, second: second.ok },
    },
    null,
    2,
  ),
);
process.exit(pass && first.ok && !second.ok ? 0 : 2);
