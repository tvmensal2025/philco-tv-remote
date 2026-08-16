import { readFile } from 'node:fs/promises';
import pino from 'pino';
import {
  alignCropToFrame,
  containSubjectCrop,
  cropNeedsPadBlur,
  mapBoxToFrame,
  openReelsCrop,
  pickOpenStageSubject,
  pickStandingSubject,
  rankCameras,
  type CameraRankInput,
  type CameraRole,
  type RankedCamera,
} from '@reelops/shared';
import { config } from '../config.js';
import { yoloCircuit, yoloSlot } from '../engine/provider-slots.js';

const log = pino({ level: config.LOG_LEVEL });

export type YoloMode = 'auto' | 'person' | 'face' | 'plate';
export type YoloCropBBox = [number, number, number, number];

export type YoloFrameResult = {
  success: boolean;
  frame?: { width: number; height: number };
  crop?: {
    aspect: string;
    bbox: YoloCropBBox;
    anchor: string;
    score: number;
    mode?: 'crop' | 'pad_blur';
    tight?: boolean;
  };
  people?: Array<{ bbox: YoloCropBBox; is_full_body?: boolean; confidence?: number }>;
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

export type YoloHealth = {
  ok: boolean;
  loaded: boolean;
  device: string | null;
  reason?: string;
  models_loaded?: Record<string, unknown>;
  latencyMs?: number;
};

export function parseYoloHealth(payload: unknown, httpStatus: number): YoloHealth {
  if (httpStatus !== 200)
    return { ok: false, loaded: false, device: null, reason: `http_${httpStatus}` };
  if (!payload || typeof payload !== 'object') {
    return { ok: false, loaded: false, device: null, reason: 'empty' };
  }
  const obj = payload as Record<string, unknown>;
  const status = String(obj.status ?? '').toLowerCase();
  const device = typeof obj.device === 'string' ? obj.device.trim() : '';
  const models =
    obj.models_loaded && typeof obj.models_loaded === 'object'
      ? (obj.models_loaded as Record<string, unknown>)
      : {};
  const loaded = models.detect === true;
  const ok = (status === 'healthy' || status === 'ok') && device.length > 0;
  return {
    ok,
    loaded,
    device: device || null,
    reason: ok ? undefined : 'incomplete',
    models_loaded: models,
  };
}

export async function probeYoloHealth(timeoutMs = 2500): Promise<YoloHealth> {
  if (!isYoloConfigured() || !config.YOLO_URL) {
    return { ok: false, loaded: false, device: null, reason: 'disabled' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const headers: Record<string, string> = {};
    if (config.YOLO_API_KEY) headers.authorization = `Bearer ${config.YOLO_API_KEY}`;
    const response = await fetch(`${config.YOLO_URL}/health`, {
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        return {
          ok: false,
          loaded: false,
          device: null,
          reason: 'non_json',
          latencyMs: Date.now() - started,
        };
      }
    }
    return { ...parseYoloHealth(payload, response.status), latencyMs: Date.now() - started };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      loaded: false,
      device: null,
      reason: aborted ? 'YOLO_TIMEOUT' : 'unreachable',
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeFrameFile(input: {
  path: string;
  mode: YoloMode;
}): Promise<YoloFrameResult | null> {
  if (!config.YOLO_URL) return null;
  if (!yoloCircuit.allow()) {
    log.warn({ mode: input.mode }, 'yolo circuit open; keeping center crop');
    return null;
  }
  return yoloSlot.run(() => analyzeFrameFileUncapped(input));
}

async function analyzeFrameFileUncapped(input: {
  path: string;
  mode: YoloMode;
}): Promise<YoloFrameResult | null> {
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
    if (response.status === 429) {
      yoloCircuit.failure();
      log.warn({ status: 429, mode: input.mode }, 'YOLO_BUSY');
      return null;
    }
    if (!response.ok) {
      yoloCircuit.failure();
      log.warn({ status: response.status, mode: input.mode }, 'yolo analyze-frame failed');
      return null;
    }
    yoloCircuit.success();
    return (await response.json()) as YoloFrameResult;
  } catch (error) {
    yoloCircuit.failure();
    const aborted = error instanceof Error && error.name === 'AbortError';
    log.warn(
      {
        err: aborted ? 'YOLO_TIMEOUT' : error instanceof Error ? error.message : String(error),
        mode: input.mode,
      },
      aborted ? 'YOLO_TIMEOUT' : 'yolo unreachable; keeping center crop',
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type SourceSize = { width: number; height: number };

export async function applyYoloCrops(input: {
  scenes: Array<{
    position: number;
    role?: string;
    crop?: YoloCropBBox;
    cropMode?: 'crop' | 'pad_blur';
    cropTight?: boolean;
  }>;
  framePaths: Array<{ cameraPosition: number; path: string; sceneIndex?: number }>;
  sourceByCamera?: Map<number, SourceSize>;
  reels?: boolean;
}) {
  const perTake = input.framePaths.some((frame) => typeof frame.sceneIndex === 'number');
  if (perTake) {
    let takes = 0;
    for (let index = 0; index < input.scenes.length; index += 1) {
      const scene = input.scenes[index]!;
      const files = input.framePaths
        .filter((frame) => frame.sceneIndex === index)
        .map((frame) => frame.path);
      const results: YoloFrameResult[] = [];
      for (const path of files.slice(0, 1)) {
        const result = await analyzeFrameFile({ path, mode: yoloModeForRole(scene.role) });
        if (result) results.push(result);
      }
      const crop = fitSubjectCrop(results, input.sourceByCamera?.get(scene.position), {
        reels: input.reels,
      });
      if (!crop) continue;
      scene.crop = crop.bbox;
      scene.cropMode = crop.mode;
      scene.cropTight = crop.tight;
      takes += 1;
    }
    return { cameras: takes, frames: input.framePaths.length, perTake: true };
  }
  const filesByCamera = new Map<number, string[]>();
  for (const frame of input.framePaths) {
    const list = filesByCamera.get(frame.cameraPosition) ?? [];
    list.push(frame.path);
    filesByCamera.set(frame.cameraPosition, list);
  }
  const cropByCamera = new Map<number, ReturnType<typeof fitSubjectCrop>>();
  for (const scene of input.scenes) {
    if (cropByCamera.has(scene.position)) continue;
    const files = (filesByCamera.get(scene.position) ?? []).slice(0, 2);
    const results: YoloFrameResult[] = [];
    for (const path of files) {
      const result = await analyzeFrameFile({ path, mode: yoloModeForRole(scene.role) });
      if (result) results.push(result);
    }
    const crop = fitSubjectCrop(results, input.sourceByCamera?.get(scene.position), {
      reels: input.reels,
    });
    if (crop) cropByCamera.set(scene.position, crop);
  }
  for (const scene of input.scenes) {
    const crop = cropByCamera.get(scene.position);
    if (!crop) continue;
    scene.crop = crop.bbox;
    scene.cropMode = crop.mode;
    scene.cropTight = crop.tight;
  }
  return { cameras: cropByCamera.size, frames: input.framePaths.length, perTake: false };
}

function isDownscaledAnalysisFrame(frame?: { width?: number; height?: number }) {
  return Boolean(frame?.width && frame.width <= 640);
}

export function fitSubjectCrop(
  results: YoloFrameResult[],
  source?: SourceSize,
  opts?: { reels?: boolean },
) {
  for (const result of results) {
    const people = (result.people ?? []).filter((row) => row.bbox?.length === 4);
    const subject = opts?.reels
      ? pickOpenStageSubject(
          people.map((row) => ({ bbox: row.bbox, is_full_body: row.is_full_body })),
        )
      : pickStandingSubject(
          people.map((row) => ({ bbox: row.bbox, is_full_body: row.is_full_body })),
        );
    const frame = result.frame;
    if (subject && frame?.width && frame.height) {
      if (!source && isDownscaledAnalysisFrame(frame)) continue;
      const mapped = source ? mapBoxToFrame(subject, frame, source) : subject;
      const fitted = opts?.reels
        ? openReelsCrop({
            frameWidth: source?.width ?? frame.width,
            frameHeight: source?.height ?? frame.height,
            subject: mapped,
          })
        : containSubjectCrop({
            frameWidth: source?.width ?? frame.width,
            frameHeight: source?.height ?? frame.height,
            subject: mapped,
          });
      return { bbox: fitted.bbox, mode: fitted.mode, tight: fitted.tight };
    }
  }
  if (opts?.reels) {
    const frame = source ?? results.find((row) => row.frame?.width)?.frame;
    if (frame?.width && frame.height) {
      const fitted = openReelsCrop({
        frameWidth: frame.width,
        frameHeight: frame.height,
      });
      return { bbox: fitted.bbox, mode: fitted.mode, tight: fitted.tight };
    }
  }
  const fallback = pickStableCrop(results);
  if (!fallback) return undefined;
  const meta = results
    .map((row) => row.crop)
    .find((crop) => crop && crop.bbox.join(',') === fallback.join(','));
  const analysis = results.find(
    (row) => row.crop && row.crop.bbox.join(',') === fallback.join(','),
  );
  const from = analysis?.frame;
  if (!source && isDownscaledAnalysisFrame(from)) return undefined;
  const mapped =
    source && from?.width && from.height
      ? mapBoxToFrame(
          { x: fallback[0], y: fallback[1], w: fallback[2], h: fallback[3] },
          from,
          source,
        )
      : { x: fallback[0], y: fallback[1], w: fallback[2], h: fallback[3] };
  const frame = source ?? (from?.width && from.height ? from : undefined);
  const bbox = frame
    ? alignCropToFrame(mapped, frame)
    : ([
        Math.round(mapped.x),
        Math.round(mapped.y),
        Math.round(mapped.w),
        Math.round(mapped.h),
      ] as YoloCropBBox);
  const mode =
    meta?.mode === 'pad_blur' || cropNeedsPadBlur({ crop: bbox })
      ? ('pad_blur' as const)
      : ('crop' as const);
  return { bbox, mode, tight: Boolean(meta?.tight) || mode === 'pad_blur' };
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

export async function inspectCameras(input: {
  cameras: Array<{ position: number; role?: string }>;
  framePaths: Array<{ cameraPosition: number; path: string }>;
}): Promise<RankedCamera[]> {
  const filesByCamera = new Map<number, string[]>();
  for (const frame of input.framePaths) {
    const list = filesByCamera.get(frame.cameraPosition) ?? [];
    list.push(frame.path);
    filesByCamera.set(frame.cameraPosition, list);
  }
  const rows: CameraRankInput[] = [];
  for (const camera of input.cameras) {
    const files = (filesByCamera.get(camera.position) ?? []).slice(0, 3);
    const results: YoloFrameResult[] = [];
    for (const path of files) {
      const result = await analyzeFrameFile({ path, mode: yoloModeForRole(camera.role) });
      if (result) results.push(result);
    }
    const food = results.filter((row) => row.has_plate_scene).length / Math.max(1, results.length);
    const person = results.filter((row) => row.has_person).length / Math.max(1, results.length);
    const centered = results.filter((row) => row.crop?.anchor === 'frame_center').length;
    rows.push({
      cameraPosition: camera.position,
      cameraRole: camera.role ?? 'master',
      foodVisibility: food,
      personVisibility: person,
      lighting: centered === results.length && results.length ? 0.28 : 0.62,
      blur: 0.2,
      occlusion: person < 0.2 && food < 0.2 ? 0.45 : 0.12,
      cropFeasibility: results.some((row) => row.crop && row.crop.anchor !== 'frame_center')
        ? 0.85
        : 0.4,
      trackingStability: 0.5,
      actionCompleteness: Math.max(food, person),
    });
  }
  return rankCameras(rows);
}

export async function trackClipFile(localPath: string) {
  if (!isYoloConfigured() || !config.YOLO_URL) return null;
  if (!yoloCircuit.allow()) return null;
  return yoloSlot.run(async () => {
    const bytes = await readFile(localPath);
    const body = new FormData();
    body.append('video', new Blob([bytes], { type: 'video/mp4' }), 'clip.mp4');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.YOLO_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {};
      if (config.YOLO_API_KEY) headers.authorization = `Bearer ${config.YOLO_API_KEY}`;
      const response = await fetch(`${config.YOLO_URL}/track-clip?fps_sample=4&max_seconds=8`, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        yoloCircuit.failure();
        return null;
      }
      yoloCircuit.success();
      return (await response.json()) as {
        tracker?: string;
        frame?: { width: number; height: number };
        people?: Array<{
          time_ms: number;
          track_id: number | null;
          class_name: string;
          confidence: number;
          bbox: [number, number, number, number];
        }>;
        food?: Array<{
          time_ms: number;
          track_id: number | null;
          class_name: string;
          confidence: number;
          bbox: [number, number, number, number];
        }>;
        inference_time_ms?: number;
      };
    } catch {
      yoloCircuit.failure();
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
}
