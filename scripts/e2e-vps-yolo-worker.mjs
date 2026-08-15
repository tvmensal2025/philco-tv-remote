import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function hostOf(value) {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return 'invalid';
  }
}

async function probe(url, timeoutMs = 8000) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let body = text.slice(0, 400);
    try {
      body = JSON.parse(text);
    } catch {
      /* html */
    }
    return { url, status: res.status, ms: Date.now() - started, body };
  } catch (error) {
    return {
      url,
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    };
  }
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const now = Date.now();

const yoloHealth = await probe('https://cenapronta-yolo.d9v63q.easypanel.host/health');
const yoloRoot = await probe('https://cenapronta-yolo.d9v63q.easypanel.host/');

const candidates = [
  env.APP_URL ? `${String(env.APP_URL).replace(/\/$/, '')}/api/ready` : null,
  env.APP_URL ? `${String(env.APP_URL).replace(/\/$/, '')}/api/health` : null,
  'https://cenapronta.d9v63q.easypanel.host/api/ready',
  'https://cenapronta-web.d9v63q.easypanel.host/api/ready',
  'https://cenapronta-worker.d9v63q.easypanel.host/',
  'https://cenapronta-worker.d9v63q.easypanel.host/health',
].filter(Boolean);

const http = [];
for (const url of candidates) http.push(await probe(url));

const { data: nodes, error: nodesError } = await sb
  .from('worker_nodes')
  .select('id,last_seen_at,metadata')
  .order('last_seen_at', { ascending: false })
  .limit(10);

const workers = (nodes ?? []).map((node) => {
  const meta = node.metadata ?? {};
  const ageMs = now - Date.parse(node.last_seen_at);
  return {
    id: node.id,
    hostname: meta.hostname ?? null,
    last_seen_at: node.last_seen_at,
    age_s: Math.round(ageMs / 1000),
    live: ageMs < 90_000,
    visionProvider: meta.visionProvider ?? null,
    visionModel: meta.visionModel ?? null,
    vision_real: meta.vision_real ?? null,
    openai: meta.openai ?? null,
    gemini: meta.gemini ?? null,
    video: meta.video ?? null,
    renderProfile: meta.renderProfile ?? null,
    rawLifecycle: meta.rawLifecycle ?? null,
    yolo_in_heartbeat: 'yolo' in meta || 'ENABLE_YOLO' in meta || 'yoloUrl' in meta,
    metadata_keys: Object.keys(meta).sort(),
  };
});

const { data: reels } = await sb
  .from('reels')
  .select('id,title,status,updated_at,metadata')
  .order('updated_at', { ascending: false })
  .limit(8);

const recent = (reels ?? []).map((reel) => {
  const meta = reel.metadata ?? {};
  const timings = meta.timings ?? {};
  return {
    id: reel.id,
    title: reel.title,
    status: reel.status,
    updated_at: reel.updated_at,
    owner_worker_id: meta.owner_worker_id ?? null,
    yoloMs: timings.yoloMs ?? timings.yolo_ms ?? null,
    has_yolo_timing: 'yoloMs' in timings || 'yolo_ms' in timings,
    director_used: meta.director_used ?? null,
    timeline_source: meta.timeline_source ?? null,
    composition_renderer_used: meta.composition_renderer_used ?? null,
    vision_real: meta.vision_real ?? null,
    recovery_action: meta.recovery_action ?? null,
  };
});

const report = {
  local_env: {
    ENABLE_YOLO: env.ENABLE_YOLO ?? 'MISSING',
    YOLO_URL_host: hostOf(env.YOLO_URL),
    APP_URL_host: hostOf(env.APP_URL),
  },
  yolo: { root: yoloRoot, health: yoloHealth },
  http,
  worker_nodes_error: nodesError?.message ?? null,
  workers,
  live_workers: workers.filter((w) => w.live),
  recent_reels: recent,
};
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/vps-yolo-worker.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
