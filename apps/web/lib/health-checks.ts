import { spawn } from 'node:child_process';
import { Redis } from 'ioredis';
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
    const counts = await videoQueue().getJobCounts('wait', 'active', 'completed', 'failed');
    checks.bullmq = {
      ok: true,
      detail: `wait=${counts.wait ?? 0} active=${counts.active ?? 0} failed=${counts.failed ?? 0}`,
    };
  } catch (error) {
    checks.bullmq = { ok: false, detail: error instanceof Error ? error.message : 'Erro' };
  }
  try {
    const { data } = await adminClient()
      .from('worker_nodes')
      .select('last_seen_at,metadata')
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const age = data ? Date.now() - Date.parse(data.last_seen_at) : Infinity;
    const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
    checks.worker = { ok: age < 90_000, detail: data?.last_seen_at ?? 'Nenhum heartbeat' };
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
    const geminiDetail = !gemini
      ? 'Gemini: missing'
      : geminiBlocked
        ? 'Gemini: configured but blocked'
        : provider === 'openai'
          ? 'Gemini: configured but idle'
          : 'Gemini: configured';
    const openaiDetail = openai ? 'OpenAI: active' : 'OpenAI: missing';
    checks.vision = {
      ok: true,
      detail: `${geminiDetail}; ${openaiDetail}; Vision: ${real ? 'REAL' : 'HEURISTIC'}`,
    };
    if (metadata.rawLifecycle === 'unconfigured') {
      checks.rawRetention = {
        ok: false,
        detail: 'MinIO lifecycle for cenapronta/raw/ was not applied; configure 7-day expiry',
      };
    } else if (metadata.rawLifecycle === 'ok') {
      checks.rawRetention = { ok: true, detail: '7-day raw prefix lifecycle' };
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
  const ok = ['supabase', 'minio', 'redis', 'bullmq', 'worker', 'ffmpeg', 'ffprobe'].every(
    (key) => checks[key]?.ok,
  );
  return {
    status: ok ? 'healthy' : 'degraded',
    configured: true,
    checks,
    config: getConfigItems().map(({ key, configured, required }) => ({
      key,
      configured,
      required,
    })),
  };
}
