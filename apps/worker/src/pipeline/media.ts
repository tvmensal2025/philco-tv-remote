import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { minio, db, log } from '../services.js';
import { config } from '../config.js';
import { calendarDay, parseSegmentStartMs } from '@reelops/shared';
import { Client } from 'minio';
import type { ClipCandidate } from '../adapters/analyzer.js';
import { hasAudioStream } from './ffmpeg.js';
import { locateRecordings } from '../engine/recording-locator.js';
import { cameraRoleOf } from '../engine/playbook.js';

type Camera = {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  position: number;
  storage_prefix: string;
  source_config?: { role?: string } | null;
  role?: string | null;
};
type StoredSegment = { name: string; startedAt: number; endedAt: number };

export async function collectCameraClips(
  tenantId: string,
  restaurantId: string,
  start: string,
  end: string,
  dir: string,
): Promise<ClipCandidate[]> {
  await mkdir(dir, { recursive: true });
  const windowStart = Date.parse(start);
  const windowEnd = Date.parse(end);
  const timeline = await locateRecordings({
    tenantId,
    restaurantId,
    windowStart: start,
    windowEnd: end,
  });
  const { data: cameras, error } = await db
    .from('cameras')
    .select('id,tenant_id,restaurant_id,position,storage_prefix,source_config')
    .eq('tenant_id', tenantId)
    .eq('restaurant_id', restaurantId)
    .eq('enabled', true)
    .order('position');
  if (error) throw error;

  const clips: ClipCandidate[] = [];
  for (const camera of (cameras ?? []) as Camera[]) {
    const located = timeline.cameras.find((item) => item.cameraId === camera.id);
    let segments: StoredSegment[] = (located?.recordings ?? [])
      .map((item) => ({
        name: item.object_key,
        startedAt: Date.parse(item.started_at) - located!.offsetMs,
        endedAt: Date.parse(item.ended_at) - located!.offsetMs,
      }))
      .filter((item) => Number.isFinite(item.startedAt) && Number.isFinite(item.endedAt));

    if (!segments.length && config.ALLOW_STORAGE_SCAN_FALLBACK) {
      log.warn(
        { camera: camera.position, prefix: camera.storage_prefix },
        'ALLOW_STORAGE_SCAN_FALLBACK listing MinIO',
      );
      segments = await findObjects(camera.storage_prefix, windowStart, windowEnd);
    }
    if (!segments.length) continue;

    const coverageStart = Math.min(...segments.map((item) => item.startedAt));
    const coverageEnd = Math.max(...segments.map((item) => item.endedAt));
    if (coverageEnd <= windowStart || coverageStart >= windowEnd) continue;

    const cameraDir = path.join(dir, `camera-${camera.position}`);
    await mkdir(cameraDir, { recursive: true });
    const localSegments: string[] = [];
    for (const [index, segment] of segments.entries()) {
      const local = path.join(cameraDir, `${String(index).padStart(3, '0')}.mp4`);
      await downloadObject(segment.name, local);
      localSegments.push(local);
    }
    const manifest = path.join(cameraDir, 'segments.txt');
    await writeFile(
      manifest,
      localSegments.map((local) => `file '${toFfmpegPath(local)}'`).join('\n'),
      'utf8',
    );
    clips.push({
      cameraId: camera.id,
      recordingId: located?.recordings[0]?.id,
      path: segments.map((segment) => segment.name).join(','),
      localPath: localSegments.length === 1 ? localSegments[0] : manifest,
      position: camera.position,
      startOffsetSeconds: Math.max(0, (windowStart - coverageStart) / 1000),
      windowDurationSeconds: Math.max(1, (windowEnd - windowStart) / 1000),
      hasAudio: await hasAudioStream(localSegments[0]),
      role: cameraRoleOf(camera.position, camera.role ?? camera.source_config?.role),
    });
  }
  return clips;
}

async function findObjects(
  prefix: string,
  windowStart: number,
  windowEnd: number,
): Promise<StoredSegment[]> {
  const scanStart = windowStart - config.NVR_SEGMENT_SECONDS * 1000;
  const scanEnd = windowEnd;
  const days = uniqueDays(scanStart, scanEnd);
  const candidates: StoredSegment[] = [];

  await Promise.all(
    days.map(
      (day) =>
        new Promise<void>((resolve, reject) => {
          const stream = minio.listObjectsV2(config.MINIO_BUCKET, `${prefix}/${day}/`, true);
          stream.on('data', (object) => {
            if (!object.name?.endsWith('.mp4')) return;
            const startedAt = parseSegmentStartMs(object.name);
            if (!Number.isNaN(startedAt) && startedAt >= scanStart && startedAt <= scanEnd) {
              candidates.push({
                name: object.name,
                startedAt,
                endedAt: startedAt + config.NVR_SEGMENT_SECONDS * 1000,
              });
            }
          });
          stream.on('error', reject);
          stream.on('end', resolve);
        }),
    ),
  );
  return candidates.sort((a, b) => a.startedAt - b.startedAt);
}

function uniqueDays(start: number, end: number) {
  const days = new Set<string>();
  for (let ts = start; ts <= end; ts += 6 * 60 * 60 * 1000) {
    days.add(calendarDay(new Date(ts)));
  }
  days.add(calendarDay(new Date(end)));
  return [...days];
}

export async function downloadObject(objectPath: string, localPath: string, timeoutMs = 90_000) {
  await mkdir(path.dirname(localPath), { recursive: true });
  const stream = await minio.getObject(config.MINIO_BUCKET, objectPath);
  const write = createWriteStream(localPath);
  const timeout = setTimeout(() => {
    stream.destroy(new Error('MINIO_TIMEOUT'));
    write.destroy();
  }, timeoutMs);
  try {
    await pipeline(stream, write);
  } finally {
    clearTimeout(timeout);
  }
  return localPath;
}

export async function uploadOutput(local: string, objectPath: string) {
  await minio.fPutObject(config.MINIO_BUCKET, objectPath, local, { 'Content-Type': 'video/mp4' });
}
export async function uploadThumbnail(local: string, objectPath: string) {
  await minio.fPutObject(config.MINIO_BUCKET, objectPath, local, { 'Content-Type': 'image/jpeg' });
}

export async function copyObject(source: string, dest: string) {
  await minio.copyObject(config.MINIO_BUCKET, dest, `/${config.MINIO_BUCKET}/${source}`);
}

function toFfmpegPath(local: string) {
  return path.resolve(local).replaceAll('\\', '/').replaceAll("'", "'\\''");
}

export async function presignPublicGet(objectPath: string, expirySeconds = 12 * 60 * 60) {
  if (!config.MINIO_PUBLIC_ENDPOINT) throw new Error('MINIO_PUBLIC_ENDPOINT_REQUIRED');
  const publicStorage = new Client({
    endPoint: config.MINIO_PUBLIC_ENDPOINT,
    port: config.MINIO_PUBLIC_PORT,
    useSSL: config.MINIO_PUBLIC_SSL,
    accessKey: config.MINIO_ACCESS_KEY,
    secretKey: config.MINIO_SECRET_KEY,
  });
  return publicStorage.presignedGetObject(config.MINIO_BUCKET, objectPath, expirySeconds);
}
