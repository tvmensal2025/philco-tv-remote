import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { minio, db } from "../services.js";
import { config } from "../config.js";
import type { ClipCandidate } from "../adapters/analyzer.js";
import { hasAudioStream } from "./ffmpeg.js";

type Camera = { id: string; tenant_id: string; restaurant_id: string; position: number; storage_prefix: string };
type StoredSegment = { name: string; startedAt: number };

export async function collectCameraClips(tenantId: string, restaurantId: string, start: string, end: string, dir: string): Promise<ClipCandidate[]> {
  await mkdir(dir, { recursive: true });
  const { data: cameras, error } = await db.from("cameras").select("id,tenant_id,restaurant_id,position,storage_prefix").eq("tenant_id", tenantId).eq("restaurant_id", restaurantId).eq("enabled", true).order("position");
  if (error) throw error;

  const windowStart = Date.parse(start);
  const windowEnd = Date.parse(end);
  const clips: ClipCandidate[] = [];
  for (const camera of (cameras ?? []) as Camera[]) {
    const canonicalPrefix = `raw/${tenantId}/${restaurantId}/camera-${camera.position}`;
    if (camera.storage_prefix !== canonicalPrefix) throw new Error(`INVALID_CAMERA_PREFIX:${camera.id}`);
    const segments = await findObjects(canonicalPrefix, windowStart, windowEnd);
    if (!segments.length) continue;

    const coverageStart = segments[0].startedAt;
    const coverageEnd = segments.at(-1)!.startedAt + config.NVR_SEGMENT_SECONDS * 1000;
    if (coverageStart > windowStart || coverageEnd < windowEnd) continue;

    const cameraDir = path.join(dir, `camera-${camera.position}`);
    await mkdir(cameraDir, { recursive: true });
    const localSegments: string[] = [];
    for (const [index, segment] of segments.entries()) {
      const local = path.join(cameraDir, `${String(index).padStart(3, "0")}.mp4`);
      const stream = await minio.getObject(config.MINIO_BUCKET, segment.name);
      await pipeline(stream, createWriteStream(local));
      localSegments.push(local);
    }
    const manifest = path.join(cameraDir, "segments.txt");
    await writeFile(manifest, localSegments.map((local) => `file '${local.replaceAll("'", "'\\''")}'`).join("\n"), "utf8");
    clips.push({
      cameraId: camera.id,
      path: segments.map((segment) => segment.name).join(","),
      localPath: manifest,
      position: camera.position,
      startOffsetSeconds: Math.max(0, (windowStart - coverageStart) / 1000),
      hasAudio: await hasAudioStream(localSegments[0])
    });
  }
  return clips;
}

async function findObjects(prefix: string, windowStart: number, windowEnd: number): Promise<StoredSegment[]> {
  const scanStart = windowStart - config.NVR_SEGMENT_SECONDS * 1000;
  const scanEnd = windowEnd;
  const days = uniqueDays(scanStart, scanEnd);
  const candidates: StoredSegment[] = [];

  await Promise.all(days.map((day) => new Promise<void>((resolve, reject) => {
    const stream = minio.listObjectsV2(config.MINIO_BUCKET, `${prefix}/${day}/`, true);
    stream.on("data", (object) => {
      if (!object.name?.endsWith(".mp4")) return;
      const filename = object.name.split("/").pop()!.replace(/\.mp4$/, "");
      const startedAt = Date.parse(filename);
      if (!Number.isNaN(startedAt) && startedAt >= scanStart && startedAt <= scanEnd) candidates.push({ name: object.name, startedAt });
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  })));
  return candidates.sort((a, b) => a.startedAt - b.startedAt);
}

function uniqueDays(start: number, end: number) {
  const days = new Set<string>();
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= end) {
    days.add(cursor.toISOString().slice(0, 10).replaceAll("-", "/"));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return [...days];
}

export async function uploadOutput(local: string, objectPath: string) { await minio.fPutObject(config.MINIO_BUCKET, objectPath, local, { "Content-Type": "video/mp4" }); }
export async function uploadThumbnail(local: string, objectPath: string) { await minio.fPutObject(config.MINIO_BUCKET, objectPath, local, { "Content-Type": "image/jpeg" }); }
