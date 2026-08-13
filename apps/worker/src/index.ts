import { Worker } from "bullmq";
import { QUEUES } from "@reelops/shared";
import { hostname } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { redis, log, db, minio } from "./services.js";
import { processVideo } from "./pipeline/video-job.js";
import { createPublisher } from "./adapters/publisher.js";

await bootstrapStorage();
await mkdir(config.WORK_DIR, { recursive: true });
const workerId = `${hostname()}-${process.pid}`;

const video = new Worker(QUEUES.video, processVideo, { connection: redis, concurrency: config.WORKER_CONCURRENCY, lockDuration: 15 * 60 * 1000 });
const publishing = new Worker(QUEUES.publishing, async (job) => {
  const { publicationId, reelId, tenantId, provider } = job.data as { publicationId: string; reelId: string; tenantId: string; provider: string };
  const { data: reel } = await db.from("reels").select("output_path,title,caption").eq("id", reelId).eq("tenant_id", tenantId).single();
  if (!reel?.output_path) throw new Error("REEL_FILE_NOT_FOUND");
  await db.from("publications").update({ status: "publishing" }).eq("id", publicationId).eq("tenant_id", tenantId);
  try {
    const result = await createPublisher(provider).publish({ reelId, provider, objectPath: reel.output_path, caption: reel.caption || reel.title || "Um momento especial ✨" });
    const { error: publicationError } = await db.from("publications").update({ status: "published", external_id: result.externalId, error_message: null }).eq("id", publicationId).eq("tenant_id", tenantId);
    if (publicationError) throw publicationError;
    const { error: reelError } = await db.from("reels").update({ status: "published", published_at: new Date().toISOString() }).eq("id", reelId).eq("tenant_id", tenantId).eq("status", "publishing");
    if (reelError) throw reelError;
  } catch (error) {
    const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
    if (finalAttempt) {
      await db.from("publications").update({ status: "failed", error_message: error instanceof Error ? error.message : "Erro" }).eq("id", publicationId).eq("tenant_id", tenantId);
      await db.from("reels").update({ status: "approved" }).eq("id", reelId).eq("tenant_id", tenantId).eq("status", "publishing");
    }
    throw error;
  }
}, { connection: redis, concurrency: 1, lockDuration: 10 * 60 * 1000 });

async function heartbeat() {
  const now = new Date().toISOString();
  await Promise.all([
    db.from("worker_nodes").upsert({ id: workerId, last_seen_at: now, metadata: { concurrency: config.WORKER_CONCURRENCY, hostname: hostname() } }),
    writeFile(path.join(config.WORK_DIR, "worker-alive"), now, "utf8")
  ]);
}

async function bootstrapStorage() {
  if (!(await minio.bucketExists(config.MINIO_BUCKET))) await minio.makeBucket(config.MINIO_BUCKET);
  try {
    const current = await minio.getBucketLifecycle(config.MINIO_BUCKET).catch(() => null);
    const rules = (current?.Rule ?? []).filter((rule) => rule.ID !== "reelops-raw-retention");
    rules.push({ ID: "reelops-raw-retention", Status: "Enabled", Filter: { Prefix: "raw/" }, Expiration: { Days: config.RAW_RETENTION_DAYS } });
    await minio.setBucketLifecycle(config.MINIO_BUCKET, { Rule: rules });
  } catch (error) {
    log.warn({ error }, "lifecycle configuration skipped; configure raw/ retention in MinIO");
  }
}

video.on("completed", (job) => log.info({ jobId: job.id }, "video completed"));
video.on("failed", (job, error) => log.error({ jobId: job?.id, error: error.message }, "video failed"));
publishing.on("completed", (job) => log.info({ jobId: job.id }, "publication completed"));
publishing.on("failed", (job, error) => log.error({ jobId: job?.id, error: error.message }, "publishing failed"));

await heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat().catch((error) => log.error({ error }, "heartbeat failed")), 30_000);

async function shutdown() {
  clearInterval(heartbeatTimer);
  log.info("shutting down");
  await Promise.all([video.close(), publishing.close()]);
  await db.from("worker_nodes").delete().eq("id", workerId);
  await redis.quit();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
log.info({ concurrency: config.WORKER_CONCURRENCY, workerId }, "workers ready");
