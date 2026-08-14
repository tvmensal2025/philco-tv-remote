import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function workerPids() {
  const raw = execSync(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"',
    { encoding: 'utf8' },
  );
  const rows = JSON.parse(raw || '[]');
  const list = Array.isArray(rows) ? rows : [rows];
  return list
    .filter(
      (row) =>
        /src[\\/]index\.ts/i.test(String(row.CommandLine ?? '')) &&
        !/playwright|next dev/i.test(String(row.CommandLine ?? '')),
    )
    .map((row) => Number(row.ProcessId));
}

function startWorker() {
  const child = spawn('node', ['scripts/run-with-env.mjs', 'run', 'dev', '-w', '@reelops/worker'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PUPPETEER_CACHE_DIR:
        'c:\\Users\\plata\\Documents\\Codex\\philco-tv-remote\\work\\puppeteer-cache',
    },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const created = await fetch('http://127.0.0.1:3000/api/moments', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `reelops-tenant=${context.tenant.id}` },
  body: JSON.stringify({
    restaurantId: context.restaurant.id,
    occurredAt: '2026-08-13T16:42:35.000Z',
    beforeSeconds: 12,
    afterSeconds: 8,
    label: 'Recovery Crash',
    category: 'event',
    clientRequestId: randomUUID(),
  }),
});
const body = await created.json();
const reelIds = (body.reels ?? []).map((reel) => reel.id);
if (created.status >= 400 || reelIds.length < 1) {
  console.log(JSON.stringify({ pass: false, error: body.error ?? created.status }));
  process.exit(2);
}
const inflight = new Set(['queued', 'collecting', 'analyzing', 'rendering', 'uploading']);
let snapshot = [];
const waitStart = Date.now();
while (Date.now() - waitStart < 120_000) {
  const { data } = await sb
    .from('reels')
    .select('id,title,status,progress,updated_at')
    .in('id', reelIds);
  snapshot = data ?? [];
  if (snapshot.some((reel) => ['collecting', 'analyzing', 'rendering'].includes(reel.status)))
    break;
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
const pidsBefore = workerPids();
for (const pid of pidsBefore) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
  } catch {
    /* already gone */
  }
}
const killedAt = new Date().toISOString();
await new Promise((resolve) => setTimeout(resolve, 3000));
let restartedPid = null;
if (workerPids().length === 0) restartedPid = startWorker();
await new Promise((resolve) => setTimeout(resolve, 8000));
const pidsAfter = workerPids();
const deadline = Date.now() + 180_000;
const history = [];
while (Date.now() < deadline) {
  const { data } = await sb
    .from('reels')
    .select('id,title,status,progress,error_code,updated_at,metadata')
    .in('id', reelIds);
  const line = (data ?? []).map(
    (reel) =>
      `${reel.title}:${reel.status}:${reel.progress}:${reel.error_code ?? ''}:${reel.metadata?.recovery_count ?? 0}`,
  );
  const key = line.join('|');
  if (history[history.length - 1] !== key) history.push(key);
  if ((data ?? []).every((reel) => ['ready', 'failed', 'discarded'].includes(reel.status))) {
    snapshot = data ?? [];
    break;
  }
  snapshot = data ?? [];
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
const recoveries = snapshot.map((reel) => ({
  id: reel.id,
  title: reel.title,
  status: reel.status,
  error: reel.error_code ?? null,
  recovery_count: reel.metadata?.recovery_count ?? 0,
  recovery_reason: reel.metadata?.recovery_reason ?? null,
}));
const stuck = snapshot.filter((reel) => inflight.has(reel.status) || reel.status === 'queued');
const report = {
  momentId: body.moment?.id ?? null,
  momentStatus: created.status,
  pidsBefore,
  pidsAfter,
  restartedPid,
  killedAt,
  elapsedMs: Date.now() - waitStart,
  recoveries,
  stuck: stuck.map((reel) => ({ id: reel.id, status: reel.status, progress: reel.progress })),
  history,
  duplicateReady: recoveries.filter((reel) => reel.status === 'ready').length,
  pass: stuck.length === 0 && recoveries.every((reel) => reel.recovery_count <= 1),
};
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/recovery-crash.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(2);
