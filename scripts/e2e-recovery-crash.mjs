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
    .filter((row) => {
      const cmd = String(row.CommandLine ?? '');
      if (/playwright|next dev|apps\\web|apps\/web/i.test(cmd)) return false;
      return (
        /@reelops\/worker/i.test(cmd) ||
        /watch src[\\/]index\.ts/i.test(cmd) ||
        (/tsx[\\/]dist[\\/]preflight\.cjs/i.test(cmd) &&
          /src[\\/]index\.ts/i.test(cmd) &&
          /philco-tv-remote/i.test(cmd))
      );
    })
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

function isCasa(reel) {
  return /casa/i.test(String(reel.title ?? '')) || reel.metadata?.program === 'casa';
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

{
  const { data: all } = await sb.from('reels').select('id,title,metadata').in('id', reelIds);
  for (const reel of all ?? []) {
    if (!isCasa(reel)) {
      await sb.from('reels').update({ status: 'discarded' }).eq('id', reel.id);
    }
  }
}

const waitStart = Date.now();
let casa = null;
while (Date.now() - waitStart < 180_000) {
  const { data } = await sb
    .from('reels')
    .select('id,title,status,progress,updated_at,metadata,output_path')
    .in('id', reelIds);
  casa = (data ?? []).find(isCasa) ?? null;
  if (casa && ['analyzing', 'rendering'].includes(casa.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

const crashStage = casa?.status ?? 'unknown';
const workerBefore = workerPids();
for (const pid of workerBefore) {
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
const workerAfterStart = Date.now();
await new Promise((resolve) => setTimeout(resolve, 8000));
const workerAfter = workerPids();

const deadline = Date.now() + 15 * 60_000;
const history = [];
let snapshot = casa;
let staleDetectedAt = null;
let requeuedAt = null;
while (Date.now() < deadline) {
  const { data } = await sb
    .from('reels')
    .select('id,title,status,progress,error_code,updated_at,metadata,output_path')
    .eq('id', casa?.id ?? reelIds[0])
    .maybeSingle();
  snapshot = data;
  const recoveryCount = snapshot?.metadata?.recovery_count ?? 0;
  const line = `${snapshot?.status}:${snapshot?.progress}:${recoveryCount}:${snapshot?.metadata?.recovery_action ?? ''}`;
  if (history[history.length - 1] !== line) history.push(line);
  if (recoveryCount > 0 && !staleDetectedAt) {
    staleDetectedAt = snapshot?.metadata?.stale_detected_at ?? new Date().toISOString();
    requeuedAt = new Date().toISOString();
  }
  if (['ready', 'failed', 'discarded'].includes(snapshot?.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 4000));
}

const { data: events } = await sb
  .from('job_events')
  .select('status,created_at,message')
  .eq('reel_id', snapshot?.id)
  .order('created_at', { ascending: true });
const readyEvents = (events ?? []).filter((event) => event.status === 'ready');
const recoverEvents = (events ?? []).filter((event) =>
  /recuperando job/i.test(String(event.message ?? '')),
);
const duplicateExecutionCount = Math.max(0, readyEvents.length > 1 ? readyEvents.length - 1 : 0);
const finalOutputCount = snapshot?.output_path ? 1 : 0;
const logicalJobId = snapshot?.metadata?.logical_job_id ?? snapshot?.id;
const pass =
  snapshot?.status === 'ready' &&
  duplicateExecutionCount === 0 &&
  finalOutputCount === 1 &&
  logicalJobId === snapshot?.id &&
  (snapshot?.metadata?.recovery_count ?? 0) >= 1 &&
  !String(snapshot?.metadata?.logical_job_id ?? snapshot?.id).includes('-recover-');

const report = {
  pass,
  reel_id: snapshot?.id ?? null,
  logical_job_id: logicalJobId ?? null,
  execution_id: snapshot?.metadata?.execution_id ?? null,
  attempt: snapshot?.metadata?.recovery_count ?? 0,
  worker_before: workerBefore,
  worker_after: workerAfter,
  restartedPid,
  crash_stage: crashStage,
  stale_detected_at: staleDetectedAt,
  requeued_at: requeuedAt,
  duplicate_execution_count: duplicateExecutionCount,
  final_output_count: finalOutputCount,
  final_status: snapshot?.status ?? null,
  recovery_action: snapshot?.metadata?.recovery_action ?? null,
  killedAt,
  waitForCrashMs: Date.now() - waitStart,
  recoverWaitMs: Date.now() - workerAfterStart,
  recoverEvents: recoverEvents.length,
  history,
  momentId: body.moment?.id ?? null,
};
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/recovery-crash.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(2);
