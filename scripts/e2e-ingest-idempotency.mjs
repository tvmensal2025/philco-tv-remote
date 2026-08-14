import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: recording, error } = await sb
  .from('recordings')
  .select(
    'id,camera_id,object_key,started_at,ended_at,duration_seconds,size_bytes,checksum,idempotency_key,timestamp_source,timestamp_confidence',
  )
  .eq('tenant_id', context.tenant.id)
  .eq('restaurant_id', context.restaurant.id)
  .not('idempotency_key', 'is', null)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
if (error || !recording)
  throw new Error(error?.message ?? 'Nenhum recording com idempotency_key para o teste.');

const body = {
  cameraId: recording.camera_id,
  objectPath: recording.object_key,
  capturedAt: new Date(recording.started_at).toISOString(),
  endedAt: new Date(recording.ended_at).toISOString(),
  durationSeconds: recording.duration_seconds,
  expectedBytes: recording.size_bytes,
  checksum: recording.checksum,
  timestampSource: recording.timestamp_source,
  timestampConfidence: recording.timestamp_confidence,
  idempotencyKey: recording.idempotency_key,
};

async function complete() {
  const response = await fetch('http://127.0.0.1:3000/api/ingest/complete', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.INGEST_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? `complete ${response.status}`);
  return json;
}

const first = await complete();
const second = await complete();
if (first.recordingId !== recording.id || second.recordingId !== recording.id) {
  throw new Error(
    `esperava 1 recording ${recording.id}; veio ${first.recordingId} e ${second.recordingId}`,
  );
}
if (!second.duplicate) throw new Error('segunda chamada deveria marcar duplicate=true');

const { count, error: countError } = await sb
  .from('recordings')
  .select('id', { count: 'exact', head: true })
  .eq('idempotency_key', recording.idempotency_key);
if (countError) throw countError;
if (count !== 1) throw new Error(`esperava 1 recording para a chave; count=${count}`);
console.log(
  JSON.stringify({
    ok: true,
    recordingId: recording.id,
    first: first.duplicate ?? false,
    second: second.duplicate,
    count,
  }),
);
process.exit(0);
