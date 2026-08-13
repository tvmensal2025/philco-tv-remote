import { videoJobSchema, type VideoJob } from "@reelops/shared";
import type { Job } from "bullmq";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { collectCameraClips, uploadOutput, uploadThumbnail } from "./media.js";
import { createAnalyzer } from "../adapters/analyzer.js";
import { makeThumbnail, probeDuration, renderVertical } from "./ffmpeg.js";
import { setStatus } from "./status.js";
import { config } from "../config.js";
import { db } from "../services.js";

export async function processVideo(job: Job<VideoJob>) {
  const payload = videoJobSchema.parse(job.data);
  const authoritative = await verifyAuthoritativeData(payload);
  await mkdir(config.WORK_DIR, { recursive: true });
  const dir = await mkdtemp(path.join(config.WORK_DIR, "job-"));
  try {
    await setStatus(payload.tenantId, payload.reelId, "collecting", 10, "Buscando segmentos sincronizados das câmeras", { error_code: null, error_message: null });
    const clips = await collectCameraClips(payload.tenantId, payload.restaurantId, payload.windowStart, payload.windowEnd, dir);
    if (!clips.length) throw new Error("MEDIA_NOT_READY:Nenhum conjunto completo de segmentos encontrado");

    await setStatus(payload.tenantId, payload.reelId, "analyzing", 35, `${clips.length} câmeras sincronizadas`);
    const decision = await createAnalyzer(authoritative.style).analyze(clips);
    const requestedDuration = Math.max(3, (Date.parse(payload.windowEnd) - Date.parse(payload.windowStart)) / 1000);
    await setStatus(payload.tenantId, payload.reelId, "rendering", 55, "Montando vídeo vertical");
    const output = path.join(dir, "reel.mp4");
    const thumbnail = path.join(dir, "thumbnail.jpg");
    await renderVertical(decision.clips, requestedDuration, output);
    await makeThumbnail(output, thumbnail);
    const actualDuration = await probeDuration(output);

    await setStatus(payload.tenantId, payload.reelId, "uploading", 88, "Salvando Reel no armazenamento privado");
    const base = `generated/reels/${payload.tenantId}/${payload.restaurantId}/${payload.reelId}`;
    await uploadOutput(output, `${base}/reel.mp4`);
    await uploadThumbnail(thumbnail, `${base}/thumbnail.jpg`);
    await setStatus(payload.tenantId, payload.reelId, "ready", 100, "Reel pronto para revisão", {
      output_path: `${base}/reel.mp4`,
      thumbnail_path: `${base}/thumbnail.jpg`,
      duration_seconds: actualDuration,
      score: decision.score,
      metadata: { analysis: decision.reason, cameras: decision.clips.map((clip) => clip.cameraId), sourceAudio: decision.clips.some((clip) => clip.hasAudio) }
    });
  } catch (error) {
    const attempts = Number(job.opts.attempts ?? 1);
    const finalAttempt = job.attemptsMade + 1 >= attempts;
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    if (finalAttempt) {
      await setStatus(payload.tenantId, payload.reelId, "failed", 0, "Falha no processamento", { error_code: message.split(":")[0], error_message: message });
    } else {
      await setStatus(payload.tenantId, payload.reelId, "queued", 5, "Aguardando os segmentos completos do NVR", { error_code: null, error_message: null });
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function verifyAuthoritativeData(payload: VideoJob) {
  const { data: reel, error } = await db.from("reels").select("id,tenant_id,restaurant_id,moment_id,status,moments(occurred_at,window_start,window_end),restaurants(settings)").eq("id", payload.reelId).eq("tenant_id", payload.tenantId).single();
  if (error || !reel) throw new Error("INVALID_JOB_REEL");
  if (reel.restaurant_id !== payload.restaurantId || reel.moment_id !== payload.momentId) throw new Error("INVALID_JOB_SCOPE");
  if (["discarded", "published"].includes(reel.status)) throw new Error("JOB_NOT_PROCESSABLE");
  const moment = reel.moments as unknown as { occurred_at: string; window_start: string; window_end: string };
  if (Date.parse(moment.window_start) !== Date.parse(payload.windowStart) || Date.parse(moment.window_end) !== Date.parse(payload.windowEnd) || Date.parse(moment.occurred_at) !== Date.parse(payload.occurredAt)) throw new Error("STALE_JOB_PAYLOAD");
  const restaurant = reel.restaurants as unknown as { settings: Record<string, unknown> };
  return { style: String(restaurant.settings?.active_style ?? "natural") };
}
