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
const redisUrl = (env.REDIS_URL || 'redis://127.0.0.1:6379').replace(
  /:\/\/(?:redis|cenaforte)(?=[:/?]|$)/,
  '://127.0.0.1',
);
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue('video-pipeline', { connection });
const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'paused'], 0, 200);
const report = [];
for (const job of jobs) {
  const state = await job.getState();
  const token = await connection.get(`bull:video-pipeline:${job.id}:lock`);
  const keepLatest =
    String(job.id ?? '').includes('retry-') &&
    Number(String(job.id).split('retry-')[1] ?? 0) >= 1786735610000;
  if (keepLatest) {
    report.push({ id: job.id, state, action: 'keep' });
    continue;
  }
  try {
    if (state === 'active' && token) {
      await job.moveToFailed(new Error('zombie_lock'), token, true);
      report.push({ id: job.id, state, action: 'moveToFailed' });
    } else {
      await job.remove();
      report.push({ id: job.id, state, action: 'removed' });
    }
  } catch (error) {
    report.push({
      id: job.id,
      state,
      action: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
console.log(JSON.stringify(report, null, 2));
await queue.close();
await connection.quit();
