import type { Redis } from 'ioredis';
import { type CounterStore, acquireTenantSlot, releaseTenantSlot } from '@reelops/shared';

export function redisCounterStore(redis: Redis): CounterStore {
  return {
    async incr(key, ttlSeconds) {
      const value = await redis.incr(key);
      if (value === 1) await redis.expire(key, ttlSeconds);
      return value;
    },
    async decr(key) {
      const value = await redis.decr(key);
      if (value <= 0) await redis.del(key);
      return Math.max(0, value);
    },
  };
}

export async function takeTenantRenderSlot(store: CounterStore, tenantId: string, max: number) {
  return acquireTenantSlot(store, tenantId, 'render', max);
}

export async function freeTenantRenderSlot(store: CounterStore, tenantId: string) {
  await releaseTenantSlot(store, tenantId, 'render');
}
