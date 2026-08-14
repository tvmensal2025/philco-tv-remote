import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const reelId =
  process.argv[2] || JSON.parse(readFileSync('test-assets/e2e/v2-casa.json', 'utf8')).reelIds[0];
const cookie = `reelops-tenant=${JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8')).tenant.id}`;
const redisUrl = (env.REDIS_URL || 'redis://127.0.0.1:6379').replace(
  /:\/\/(?:redis|cenaforte)(?=[:/?]|$)/,
  '://127.0.0.1',
);
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue('video-pipeline', { connection });
const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'paused', 'failed'], 0, 200);
const related = [];
for (const job of jobs) {
  if (
    (job.data?.reelId ?? job.data?.jobId) !== reelId &&
    job.id !== reelId &&
    !String(job.id ?? '').startsWith(reelId)
  )
    continue;
  const state = await job.getState();
  const lock = await connection.exists(`bull:video-pipeline:${job.id}:lock`);
  related.push({ id: job.id, state, lock, program: job.data?.program ?? null });
  if (state === 'active' || state === 'waiting' || state === 'delayed' || state === 'paused') {
    await job.remove().catch(async () => {
      await job.moveToFailed(new Error('unstick_zombie_lock'), '0', true).catch(() => undefined);
    });
  }
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const upd = await sb
  .from('reels')
  .update({
    status: 'failed',
    progress: 0,
    error_code: 'STALE_JOB',
    error_message: 'unstick:requeue',
  })
  .eq('id', reelId);
if (upd.error) throw upd.error;
const res = await fetch(`http://127.0.0.1:3000/api/reels/${reelId}/action`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ action: 'retry' }),
});
const body = await res.json();
console.log(JSON.stringify({ reelId, related, retry: { status: res.status, body } }, null, 2));
await queue.close();
await connection.quit();
if (res.status >= 400) process.exit(2);
