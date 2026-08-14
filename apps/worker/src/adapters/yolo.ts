import { readFile } from 'node:fs/promises';
import pino from 'pino';
import type { CameraRole } from '@reelops/shared';
import { config } from '../config.js';

const log = pino({ level: config.LOG_LEVEL });

export type YoloMode = 'auto' | 'person' | 'face' | 'plate';
export type YoloCropBBox = [number, number, number, number];

export type YoloFrameResult = {
  success: boolean;
  crop?: { aspect: string; bbox: YoloCropBBox; anchor: string; score: number };
  has_person?: boolean;
  has_face?: boolean;
  has_plate_scene?: boolean;
  suggested_shot?: string;
};

export function yoloModeForRole(role?: CameraRole | string): YoloMode {
  if (role === 'food') return 'plate';
  if (role === 'master' || role === 'side') return 'person';
  return 'auto';
}

export function isYoloConfigured() {
  return Boolean(config.ENABLE_YOLO && config.YOLO_URL);
}

export async function analyzeFrameFile(input: {
  path: string;
  mode: YoloMode;
}): Promise<YoloFrameResult | null> {
  if (!config.YOLO_URL) return null;
  const bytes = await readFile(input.path);
  const image_base64 = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.YOLO_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.YOLO_API_KEY) headers.authorization = `Bearer ${config.YOLO_API_KEY}`;
    const response = await fetch(`${config.YOLO_URL}/analyze-frame`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image_base64,
        aspect_ratio: '9:16',
        mode: input.mode,
        include_pose: true,
        include_face: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      log.warn({ status: response.status, mode: input.mode }, 'yolo analyze-frame failed');
      return null;
    }
    return (await response.json()) as YoloFrameResult;
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : String(error), mode: input.mode },
      'yolo unreachable; keeping center crop',
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function applyYoloCrops(input: {
  scenes: Array<{ position: number; role?: string; crop?: YoloCropBBox }>;
  framePaths: Array<{ cameraPosition: number; path: string }>;
}) {
  const filesByCamera = new Map<number, string[]>();
  for (const frame of input.framePaths) {
    const list = filesByCamera.get(frame.cameraPosition) ?? [];
    list.push(frame.path);
    filesByCamera.set(frame.cameraPosition, list);
  }
  const cropByCamera = new Map<number, YoloCropBBox>();
  for (const scene of input.scenes) {
    if (cropByCamera.has(scene.position)) continue;
    const files = (filesByCamera.get(scene.position) ?? []).slice(0, 2);
    const results: YoloFrameResult[] = [];
    for (const path of files) {
      const result = await analyzeFrameFile({ path, mode: yoloModeForRole(scene.role) });
      if (result) results.push(result);
    }
    const crop = pickStableCrop(results);
    if (crop) cropByCamera.set(scene.position, crop);
  }
  for (const scene of input.scenes) {
    const crop = cropByCamera.get(scene.position);
    if (crop) scene.crop = crop;
  }
  return { cameras: cropByCamera.size, frames: input.framePaths.length };
}

export function pickStableCrop(results: YoloFrameResult[]): YoloCropBBox | undefined {
  const boxes = results
    .map((result) => result.crop)
    .filter((crop): crop is NonNullable<YoloFrameResult['crop']> =>
      Boolean(crop?.bbox?.length === 4 && crop.anchor !== 'frame_center'),
    );
  if (!boxes.length) return undefined;
  const best = boxes.sort((a, b) => b.score - a.score)[0];
  const bbox = best?.bbox;
  if (!bbox) return undefined;
  return [bbox[0], bbox[1], bbox[2], bbox[3]];
}
