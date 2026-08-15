import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function isCasa(reel) {
  return /casa/i.test(String(reel.title ?? '')) || reel.metadata?.program === 'casa';
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const now = Date.now();
const { data: nodes, error: nodesError } = await sb
  .from('worker_nodes')
  .select('id,last_seen_at,metadata')
  .order('last_seen_at', { ascending: false });
if (nodesError) {
  console.log(JSON.stringify({ pass: false, error: nodesError.message }));
  process.exit(2);
}
const live = (nodes ?? []).filter((node) => now - Date.parse(node.last_seen_at) < 90_000);
const rafaelLive = live.some((node) => /rafael/i.test(String(node.metadata?.hostname ?? node.id)));
if (live.length !== 1 || rafaelLive) {
  console.log(
    JSON.stringify({ pass: false, gate: 'LIVE_WORKER', live_count: live.length, rafaelLive }),
  );
  process.exit(2);
}
const vpsWorkerId = live[0].id;

const created = await fetch('http://127.0.0.1:3000/api/moments', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `reelops-tenant=${context.tenant.id}` },
  body: JSON.stringify({
    restaurantId: context.restaurant.id,
    occurredAt: '2026-08-13T16:42:35.000Z',
    beforeSeconds: 12,
    afterSeconds: 8,
    label: 'VPS YOLO Recovery Validation',
    category: 'event',
    clientRequestId: randomUUID(),
  }),
});
const body = await created.json();
const reels = body.reels ?? [];
if (created.status >= 400 || reels.length < 1) {
  console.log(JSON.stringify({ pass: false, error: body.error ?? created.status, body }));
  process.exit(2);
}

const casa = reels.find(isCasa) ?? reels[0];
const others = reels.filter((reel) => reel.id !== casa.id);
const staleAt = new Date(Date.now() - 3 * 60_000).toISOString();

for (const reel of others) {
  await sb
    .from('reels')
    .update({
      status: 'discarded',
      error_code: 'TEST_SKIP',
      error_message: 'Skipped non-casa for VPS YOLO proof',
    })
    .eq('id', reel.id)
    .eq('tenant_id', context.tenant.id);
}

const { data: casaRow } = await sb.from('reels').select('metadata').eq('id', casa.id).single();
const metadata = { ...(casaRow?.metadata ?? {}), program: 'casa', last_progress_at: staleAt };
await sb
  .from('reels')
  .update({ status: 'queued', metadata })
  .eq('id', casa.id)
  .eq('tenant_id', context.tenant.id);

const deadline = Date.now() + 12 * 60_000;
let last = '';
let finalRow = null;
while (Date.now() < deadline) {
  const { data, error } = await sb
    .from('reels')
    .select('id,status,progress,error_code,error_message,output_path,updated_at,metadata')
    .eq('id', casa.id)
    .single();
  if (error) throw error;
  const line = `${data.status} ${data.progress} ${data.error_code ?? ''} ${data.metadata?.owner_worker_id ?? ''}`;
  if (line !== last) {
    console.log(line);
    last = line;
  }
  if (['ready', 'failed', 'discarded'].includes(data.status)) {
    finalRow = data;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

if (!finalRow) {
  console.log(JSON.stringify({ pass: false, error: 'TIMEOUT', casaId: casa.id }));
  process.exit(3);
}

const timings = finalRow.metadata?.timings ?? {};
const report = {
  pass:
    finalRow.status === 'ready' &&
    typeof timings.yoloMs === 'number' &&
    String(finalRow.metadata?.owner_worker_id ?? '').startsWith(vpsWorkerId.split('-')[0]),
  casa_id: casa.id,
  moment_id: body.moment?.id ?? null,
  status: finalRow.status,
  progress: finalRow.progress,
  error_code: finalRow.error_code ?? null,
  error_message: finalRow.error_message ?? null,
  yoloMs: timings.yoloMs ?? null,
  has_yolo_timing: 'yoloMs' in timings,
  owner_worker_id: finalRow.metadata?.owner_worker_id ?? null,
  expected_vps_worker: vpsWorkerId,
  director_used: finalRow.metadata?.director_used ?? null,
  skipped_other_reels: others.map((reel) => reel.id),
};
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/vps-casa-yolo.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 2);
