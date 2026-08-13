import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { QUEUES, type VideoJob } from "@reelops/shared";
import { getServerEnv } from "./env";
let connection: IORedis | undefined;
let queue: Queue<VideoJob> | undefined;
let publishQueue: Queue | undefined;
export function videoQueue() {
  const env = getServerEnv();
  connection ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  queue ??= new Queue<VideoJob>(QUEUES.video, { connection });
  return queue;
}

export function publishingQueue() {
  const env = getServerEnv();
  connection ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  publishQueue ??= new Queue(QUEUES.publishing, { connection });
  return publishQueue;
}
