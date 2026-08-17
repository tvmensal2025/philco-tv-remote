import { spawn } from 'node:child_process';
import { Redis } from 'ioredis';
import {
  censusWorkers,
  oldestWaitingAgeSeconds,
  queuePressure,
  workerHealthOk,
} from '@reelops/shared';
import { adminClient } from '@/lib/supabase';
import { ensureStorage } from '@/lib/storage';
import { getConfigItems, getServerEnv } from '@/lib/env';
import { videoQueue } from '@/lib/queue';

function runVersion(binary: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('timeout'));
    }, 4000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim().split(/\r?\n/)[0] ?? binary);
      else reject(new Error(output.trim().slice(0, 200) || `${binary} ${code}`));
    });
  });
}

export async function collectHealthChecks() {
  const env = getServerEnv();
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  try {
    const { error } = await adminClient()
      .from('tenants')
      .select('id', { head: true, count: 'exact' })
      .limit(1);
    checks.supabase = { ok: !error, detail: error?.message };
  } catch (error) {
    checks.supabase = { ok: false, detail: error instanceof Error ? error.message : 'Erro' };
  }
  try {
    await ensureStorage();
    checks.storage = { ok: true, detail: env.MINIO_BUCKET };
    checks.minio = checks.storage;
  } catch (error) {
    checks.storage = { ok: false, detail: error instanceof Error ? error.message : 'Erro' };
    checks.minio = checks.storage;
  }
  let redis: Redis | undefined;
  try {
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2500,
    });
    await redis.connect();
    checks.redis = { ok: (await redis.ping()) === 'PONG' };
  } catch (error) {
    checks.redis = { ok: false, detail: error instanceof Error ? error.message : 'Erro' };
  } finally {
    redis?.disconnect();
  }
  try {
    const counts = await videoQueue().getJobCounts(
      'wait',
      'active',
      'delayed',
      'completed',
      'failed',
    );
    const waiting = await videoQueue().getJobs(['wait', 'delayed'], 0, 24);
    const oldestAge = oldestWaitingAgeSeconds(waiting.map((job) => job.timestamp));
    const pressure = queuePressure({
      waiting: counts.wait ?? 0,
      active: counts.active ?? 0,
      oldestAgeSeconds: oldestAge,
      workerSlots: 2,
    });
    checks.bullmq = {
      ok: true,
      detail: `wait=${counts.wait ?? 0} active=${counts.active ?? 0} delayed=${counts.delayed ?? 0} failed=${counts.failed ?? 0} oldest=${oldestAge}s pressure=${pressure.pressure}`,
    };
  } catch (error) {
    checks.bullmq = { ok: false, detail: error instanceof Error ? error.message : 'Erro' };
  }
  let workersCensus: ReturnType<typeof censusWorkers> | null = null;
  try {
    const { data } = await adminClient()
      .from('worker_nodes')
      .select('id,last_seen_at,metadata')
      .order('last_seen_at', { ascending: false })
      .limit(50);
    const nodes = (data ?? []).map((row) => ({
      id: row.id,
      last_seen_at: row.last_seen_at,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    }));
    workersCensus = censusWorkers(nodes);
    const requireProduction = process.env.NODE_ENV === 'production';
    checks.worker = {
      ok: workerHealthOk(workersCensus, requireProduction),
      detail: requireProduction
        ? `production_live=${workersCensus.production.live} development_live=${workersCensus.development.live}`
        : `live=${workersCensus.live_count}`,
    };
    const live = nodes.find((_, index) => workersCensus?.rows[index]?.live) ?? nodes[0];
    const metadata = (live?.metadata ?? {}) as Record<string, unknown>;
    const openai = Boolean(metadata.openai);
    const gemini = Boolean(metadata.gemini);
    const geminiBlocked = Boolean(metadata.geminiBlocked);
    const provider =
      typeof metadata.visionProvider === 'string'
        ? metadata.visionProvider
        : openai
          ? 'openai'
          : gemini
            ? 'gemini'
            : 'unknown';
    const real = metadata.vision_real === true || provider === 'openai' || provider === 'gemini';
    checks.vision = {
      ok: true,
      detail: `Vision: ${real ? 'REAL' : 'HEURISTIC'}; provider=${provider}${geminiBlocked ? '; gemini_blocked' : ''}`,
    };
    if (metadata.rawLifecycle === 'unconfigured') {
      checks.rawRetention = {
        ok: false,
        detail: 'MinIO lifecycle for cenapronta/raw/ was not applied; configure 7-day expiry',
      };
    } else if (metadata.rawLifecycle === 'ok') {
      checks.rawRetention = { ok: true, detail: '7-day raw prefix lifecycle' };
    }
    const yolo =
      metadata.yolo && typeof metadata.yolo === 'object'
        ? (metadata.yolo as Record<string, unknown>)
        : null;
    if (yolo) {
      checks.yolo = {
        ok: yolo.ok === true,
        detail: `device=${String(yolo.device ?? 'unknown')} loaded=${String(yolo.loaded)} reason=${String(yolo.reason ?? '')}`,
      };
    }
  } catch (error) {
    checks.worker = { ok: false, detail: error instanceof Error ? error.message : 'Erro' };
    checks.vision = { ok: false, detail: error instanceof Error ? error.message : 'Erro' };
  }
  try {
    checks.ffmpeg = { ok: true, detail: await runVersion('ffmpeg') };
  } catch (error) {
    checks.ffmpeg = {
      ok: false,
      detail: error instanceof Error ? error.message : 'ffmpeg ausente',
    };
  }
  try {
    checks.ffprobe = { ok: true, detail: await runVersion('ffprobe') };
  } catch (error) {
    checks.ffprobe = {
      ok: false,
      detail: error instanceof Error ? error.message : 'ffprobe ausente',
    };
  }
  const adobeId = process.env.ADOBE_CLIENT_ID?.trim();
  const adobeSecret = process.env.ADOBE_CLIENT_SECRET?.trim();
  if (adobeId && adobeSecret) {
    try {
      const { fetchAdobeAccessToken, ADOBE_AV_API_BASE, adobeAvHeaders } =
        await import('@reelops/shared');
      const token = await fetchAdobeAccessToken({ clientId: adobeId, clientSecret: adobeSecret });
      const presets = await fetch(`${ADOBE_AV_API_BASE}/v1/presets`, {
        headers: adobeAvHeaders(adobeId, token.accessToken, process.env.ADOBE_ORG_ID),
      });
      checks.adobe = {
        ok: presets.ok,
        detail: presets.ok ? 'IMS + presets DGR' : `presets ${presets.status}`,
      };
    } catch (error) {
      checks.adobe = {
        ok: false,
        detail: error instanceof Error ? error.message.slice(0, 180) : 'Adobe falhou',
      };
    }
  } else {
    checks.adobe = { ok: true, detail: 'não configurado' };
  }
  const ok = ['supabase', 'minio', 'redis', 'bullmq', 'worker'].every((key) => checks[key]?.ok);
  return {
    status: ok ? 'healthy' : 'degraded',
    configured: true,
    live: true,
    ready: true,
    workers: workersCensus
      ? {
          live: workersCensus.live_count,
          production: workersCensus.production,
          development: workersCensus.development,
          masked_by_dev: workersCensus.production_masked_by_dev,
        }
      : null,
    checks,
    config: getConfigItems().map(({ key, configured, required }) => ({
      key,
      configured,
      required,
    })),
  };
}
