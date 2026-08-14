import { Queue, QueueEvents, Worker } from 'bullmq';
import IORedis from 'ioredis';

const url =
  process.env.REDIS_URL?.replace(/:\/\/(?:redis|cenaforte)(?=[:/?]|$)/, '://127.0.0.1') ||
  'redis://127.0.0.1:6379';
const connection = new IORedis(url, { maxRetriesPerRequest: null });
const name = 'cenapronta-redis-probe';

const ping = await connection.ping();
const queue = new Queue(name, { connection });
const events = new QueueEvents(name, { connection });
await events.waitUntilReady();
const worker = new Worker(name, async (job) => ({ ok: job.data.n }), { connection });
await worker.waitUntilReady();
const job = await queue.add('probe', { n: 2 });
const result = await job.waitUntilFinished(events, 8000);
const report = {
  redis: ping === 'PONG' ? 'PASS' : 'FAIL',
  producer: job.id ? 'PASS' : 'FAIL',
  consumer: result?.ok === 2 ? 'PASS' : 'FAIL',
  urlHost: new URL(url).host,
};
console.log(JSON.stringify(report, null, 2));
await worker.close();
await queue.obliterate({ force: true });
await queue.close();
await events.close();
await connection.quit();
if (report.redis !== 'PASS' || report.producer !== 'PASS' || report.consumer !== 'PASS')
  process.exit(2);
