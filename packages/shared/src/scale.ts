export const LIVE_WORKER_MS = 90_000;
export const STALE_WORKER_MS = 30 * 60_000;

export type WorkerEnvironment = 'production' | 'development';

export type WorkerCapabilities = {
  analysis: boolean;
  vision: boolean;
  ffmpeg: boolean;
  revideo: boolean;
  yolo: boolean;
  tracking: boolean;
  index: boolean;
  highlight: boolean;
};

export type WorkerDescriptor = {
  workerId: string;
  hostname: string;
  environment: WorkerEnvironment;
  deployment: string;
  version: string;
  pipelineVersion: string;
  startedAt: string;
  heartbeatAt?: string;
  capabilities: WorkerCapabilities;
};

export function classifyWorkerEnvironment(
  hostname: string,
  explicit?: string | null,
): WorkerEnvironment {
  const value = String(explicit ?? '')
    .trim()
    .toLowerCase();
  if (value === 'production' || value === 'prod') return 'production';
  if (value === 'development' || value === 'dev' || value === 'local') return 'development';
  if (/rafael|desktop|laptop|win-|macbook|localhost/i.test(hostname)) return 'development';
  return 'production';
}

export function censusWorkers(
  nodes: Array<{ id: string; last_seen_at: string; metadata?: Record<string, unknown> | null }>,
  nowMs = Date.now(),
) {
  const rows = nodes.map((node) => {
    const metadata = node.metadata ?? {};
    const hostname = String(metadata.hostname ?? node.id);
    const ageMs = nowMs - Date.parse(node.last_seen_at);
    const environment = classifyWorkerEnvironment(
      hostname,
      typeof metadata.environment === 'string' ? metadata.environment : null,
    );
    const live = ageMs < LIVE_WORKER_MS;
    const stale = !live && ageMs < STALE_WORKER_MS;
    return {
      workerId: node.id,
      hostname,
      environment,
      deployment: typeof metadata.deployment === 'string' ? metadata.deployment : 'unknown',
      ageMs,
      live,
      stale,
      dead: !live && !stale,
      capabilities: (metadata.capabilities ?? null) as WorkerCapabilities | null,
      version: typeof metadata.version === 'string' ? metadata.version : null,
    };
  });
  const live = rows.filter((row) => row.live);
  const production = live.filter((row) => row.environment === 'production');
  const development = live.filter((row) => row.environment === 'development');
  return {
    live_count: live.length,
    stale_count: rows.filter((row) => row.stale).length,
    production: {
      live: production.length,
      stale: rows.filter((r) => r.environment === 'production' && r.stale).length,
    },
    development: {
      live: development.length,
      stale: rows.filter((r) => r.environment === 'development' && r.stale).length,
    },
    production_masked_by_dev: production.length === 0 && development.length > 0,
    rows,
  };
}

export function workerHealthOk(
  census: ReturnType<typeof censusWorkers>,
  requireProduction: boolean,
) {
  if (requireProduction) return census.production.live >= 1;
  return census.live_count >= 1;
}

export type CounterStore = {
  incr(key: string, ttlSeconds: number): Promise<number>;
  decr(key: string): Promise<number>;
};

export function tenantSlotKey(tenantId: string, kind: string) {
  return `cenapronta:tenant-active:${kind}:${tenantId}`;
}

export async function acquireTenantSlot(
  store: CounterStore,
  tenantId: string,
  kind: string,
  max: number,
  ttlSeconds = 30 * 60,
) {
  const key = tenantSlotKey(tenantId, kind);
  const active = await store.incr(key, ttlSeconds);
  if (active > max) {
    await store.decr(key);
    return { ok: false as const, active: active - 1, max };
  }
  return { ok: true as const, active, max };
}

export async function releaseTenantSlot(store: CounterStore, tenantId: string, kind: string) {
  await store.decr(tenantSlotKey(tenantId, kind));
}

export class MemoryCounterStore implements CounterStore {
  readonly values = new Map<string, number>();
  async incr(key: string) {
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }
  async decr(key: string) {
    const next = Math.max(0, (this.values.get(key) ?? 0) - 1);
    this.values.set(key, next);
    return next;
  }
}

export function jitterBackoffMs(attempt: number, baseMs = 10_000, capMs = 5 * 60_000) {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exp * (0.5 + Math.random() * 0.5));
}

export function oldestWaitingAgeSeconds(
  timestamps: Array<number | null | undefined>,
  now = Date.now(),
) {
  const ages = timestamps
    .map((value) => (typeof value === 'number' && Number.isFinite(value) ? now - value : null))
    .filter((value): value is number => value !== null && value >= 0);
  if (!ages.length) return 0;
  return Math.round(Math.max(...ages) / 1000);
}

export function queuePressure(input: {
  waiting: number;
  active: number;
  oldestAgeSeconds: number;
  workerSlots: number;
}) {
  const saturated = input.workerSlots > 0 && input.active >= input.workerSlots && input.waiting > 0;
  const delayed = input.oldestAgeSeconds >= 120;
  return {
    saturated,
    delayed,
    pressure:
      saturated || delayed ? 'high' : input.waiting > input.workerSlots * 4 ? 'elevated' : 'normal',
  };
}

export type FairJob = { tenantId: string; enqueuedAt: number };

export function simulateFairDrain(input: {
  jobs: FairJob[];
  slots: number;
  maxPerTenant: number;
  tickMs?: number;
}) {
  const tickMs = input.tickMs ?? 1000;
  const pending = input.jobs.map((job, index) => ({
    ...job,
    index,
    startedAt: null as number | null,
  }));
  const running: Array<{ tenantId: string; startedAt: number; waitMs: number }> = [];
  const completions: Array<{ tenantId: string; waitMs: number; completedAt: number }> = [];
  const inflight = new Map<string, number>();
  let now = 0;
  const limit = (input.jobs.length + 2) * tickMs;

  while (completions.length < input.jobs.length && now <= limit) {
    for (let i = running.length - 1; i >= 0; i -= 1) {
      const job = running[i]!;
      if (job.startedAt + tickMs > now) continue;
      running.splice(i, 1);
      inflight.set(job.tenantId, Math.max(0, (inflight.get(job.tenantId) ?? 0) - 1));
      completions.push({ tenantId: job.tenantId, waitMs: job.waitMs, completedAt: now });
    }
    for (const job of pending) {
      if (running.length >= input.slots) break;
      if (job.startedAt !== null) continue;
      if ((inflight.get(job.tenantId) ?? 0) >= input.maxPerTenant) continue;
      job.startedAt = now;
      inflight.set(job.tenantId, (inflight.get(job.tenantId) ?? 0) + 1);
      running.push({ tenantId: job.tenantId, startedAt: now, waitMs: now - job.enqueuedAt });
    }
    now += tickMs;
  }

  const byTenant: Record<string, number[]> = {};
  for (const item of completions) {
    (byTenant[item.tenantId] ??= []).push(item.waitMs);
  }
  const summary = Object.fromEntries(
    Object.entries(byTenant).map(([tenantId, waits]) => {
      const sorted = [...waits].sort((a, b) => a - b);
      const mean = waits.reduce((sum, value) => sum + value, 0) / waits.length;
      return [
        tenantId,
        {
          count: waits.length,
          mean,
          p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
          max: sorted[sorted.length - 1] ?? 0,
        },
      ];
    }),
  );
  return { completions, byTenant: summary, ticks: now / tickMs };
}

export function executionObjectKeys(base: string, executionId: string) {
  const staging = `${base}/.exec/${executionId}`;
  return {
    stagingVideo: `${staging}/reel.mp4`,
    stagingThumb: `${staging}/thumbnail.jpg`,
    canonicalVideo: `${base}/reel.mp4`,
    canonicalThumb: `${base}/thumbnail.jpg`,
  };
}

export function canPromoteFinalOutput(
  currentExecutionId: string | null | undefined,
  claimExecutionId: string,
) {
  if (!claimExecutionId) return false;
  if (!currentExecutionId) return true;
  return currentExecutionId === claimExecutionId;
}

export function storageQuotaState(usedBytes: number, quotaBytes: number | null | undefined) {
  if (!quotaBytes || quotaBytes <= 0) {
    return { limited: false, exceeded: false, usedBytes, quotaBytes: null, remainingBytes: null };
  }
  return {
    limited: true,
    exceeded: usedBytes >= quotaBytes,
    usedBytes,
    quotaBytes,
    remainingBytes: Math.max(0, quotaBytes - usedBytes),
  };
}
