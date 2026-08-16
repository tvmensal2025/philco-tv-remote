export type CropFit = {
  mode: 'scale' | 'crop' | 'pad_blur';
  filter: string;
};

const TARGET_W = 1080;
const TARGET_H = 1920;
const TARGET_AR = TARGET_W / TARGET_H;

export function fitVertical1080x1920(width: number, height: number): CropFit {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {
      mode: 'pad_blur',
      filter: `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2`,
    };
  }
  const src = width / height;
  if (Math.abs(src - TARGET_AR) < 0.02) {
    return { mode: 'scale', filter: `scale=${TARGET_W}:${TARGET_H}` };
  }
  if (src > TARGET_AR) {
    const cropW = evenWithin(height * TARGET_AR, width);
    const cropH = evenWithin(height, height);
    let x = evenFloor(Math.max(0, Math.floor((width - cropW) / 2)));
    if (x + cropW > width) x = evenFloor(Math.max(0, width - cropW));
    return {
      mode: 'crop',
      filter: `crop=${cropW}:${cropH}:${x}:0,scale=${TARGET_W}:${TARGET_H}`,
    };
  }
  const cropW = evenWithin(width, width);
  const cropH = evenWithin(width / TARGET_AR, height);
  let y = evenFloor(Math.max(0, Math.floor((height - cropH) / 2)));
  if (y + cropH > height) y = evenFloor(Math.max(0, height - cropH));
  return {
    mode: 'crop',
    filter: `crop=${cropW}:${cropH}:0:${y},scale=${TARGET_W}:${TARGET_H}`,
  };
}

export const defaultSafeArea = { top: 0.12, bottom: 0.14, left: 0.06, right: 0.06 };

export type Box = { x: number; y: number; w: number; h: number };
export type FrameSize = { width: number; height: number };
export type SafeArea = typeof defaultSafeArea;

export type SubjectCrop = {
  mode: 'crop' | 'pad_blur';
  bbox: [number, number, number, number];
  tight: boolean;
};

function even(value: number) {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function evenFloor(value: number) {
  const n = Math.max(0, Math.round(value));
  return n % 2 === 0 ? n : Math.max(0, n - 1);
}

function evenWithin(value: number, max: number) {
  const cap = Math.max(2, max - (max % 2));
  const sized = even(value);
  return sized > cap ? cap : sized;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampBBox(
  x: number,
  y: number,
  w: number,
  h: number,
  frame: FrameSize,
): [number, number, number, number] {
  const xx = evenFloor(clamp(Math.round(x), 0, Math.max(0, frame.width - 2)));
  const yy = evenFloor(clamp(Math.round(y), 0, Math.max(0, frame.height - 2)));
  return [xx, yy, evenWithin(w, frame.width - xx), evenWithin(h, frame.height - yy)];
}

export function alignCropToFrame(box: Box, frame: FrameSize): [number, number, number, number] {
  return clampBBox(box.x, box.y, box.w, box.h, frame);
}

/**
 * True when the bbox is in source-video pixels (720p+).
 * 480×270 vision JPEGs produce ~152×270 windows — those must never reach ffmpeg.
 */
export function isDeliverySourceCrop(bbox?: number[] | null) {
  if (!bbox || bbox.length !== 4) return false;
  const w = Number(bbox[2]);
  const h = Number(bbox[3]);
  if (![w, h].every((value) => Number.isFinite(value) && value > 0)) return false;
  if (w < 240 || h < 400) return false;
  if (w <= 512 && h >= 780) return false;
  return true;
}

/** True when a stored bbox is wider than a 9:16 slice — even if cropMode was dropped. */
export function cropNeedsPadBlur(input: {
  cropMode?: string | null;
  crop?: number[] | null;
  bbox?: number[] | null;
}) {
  if (input.cropMode === 'pad_blur') return true;
  const box = input.bbox ?? input.crop;
  if (!box || box.length !== 4) return false;
  const w = Number(box[2]);
  const h = Number(box[3]);
  if (!(w > 16) || !(h > 16)) return false;
  return w > evenWithin(h * TARGET_AR, w) + 2;
}

/** Map a box from an analysis frame (often 480px-wide) onto the source video. */
export function mapBoxToFrame(box: Box, from: FrameSize, to: FrameSize): Box {
  if (from.width < 8 || from.height < 8 || to.width < 8 || to.height < 8) return box;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  if (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return box;
  return {
    x: box.x * sx,
    y: box.y * sy,
    w: Math.max(2, box.w * sx),
    h: Math.max(2, box.h * sy),
  };
}

function expandBox(box: Box, pad: number, frame: FrameSize): Box {
  const padX = Math.max(8, box.w * pad);
  const padY = Math.max(8, box.h * pad);
  const x = clamp(box.x - padX, 0, frame.width);
  const y = clamp(box.y - padY, 0, frame.height);
  const right = clamp(box.x + box.w + padX, 0, frame.width);
  const bottom = clamp(box.y + box.h + padY, 0, frame.height);
  return { x, y, w: Math.max(2, right - x), h: Math.max(2, bottom - y) };
}

/** 9:16 window that contains the subject. If the body is wider than 9:16, pad_blur. */
export function containSubjectCrop(input: {
  frameWidth: number;
  frameHeight: number;
  subject: Box;
  pad?: number;
}): SubjectCrop {
  const frame = { width: input.frameWidth, height: input.frameHeight };
  if (frame.width < 32 || frame.height < 32 || input.subject.w < 2 || input.subject.h < 2) {
    const fit = fitVertical1080x1920(frame.width, frame.height);
    const cropW = evenWithin(frame.height * TARGET_AR, frame.width);
    const x = evenFloor(Math.max(0, Math.floor((frame.width - cropW) / 2)));
    return {
      mode: fit.mode === 'pad_blur' ? 'pad_blur' : 'crop',
      bbox: [x, 0, cropW, evenWithin(frame.height, frame.height)],
      tight: true,
    };
  }
  const padded = expandBox(input.subject, input.pad ?? 0.12, frame);
  const windowW = evenWithin(Math.min(frame.width, frame.height * TARGET_AR), frame.width);
  const windowH = evenWithin(frame.height, frame.height);
  if (padded.w <= windowW) {
    let x = Math.round(padded.x + padded.w / 2 - windowW / 2);
    if (padded.x < x) x = Math.round(padded.x);
    if (padded.x + padded.w > x + windowW) x = Math.round(padded.x + padded.w - windowW);
    x = clamp(x, 0, Math.max(0, frame.width - windowW));
    x = evenFloor(x);
    if (x + windowW > frame.width) x = evenFloor(Math.max(0, frame.width - windowW));
    const tight = padded.w > windowW * 0.78;
    return { mode: 'crop', bbox: [x, 0, windowW, windowH], tight };
  }
  return {
    mode: 'pad_blur',
    bbox: clampBBox(padded.x, padded.y, padded.w, padded.h, frame),
    tight: true,
  };
}

/** Full-height (or nearly) 9:16 window that still contains a standing person. */
export function isStandingDeliveryCrop(
  bbox: number[] | null | undefined,
  frame: FrameSize,
): boolean {
  if (!isDeliverySourceCrop(bbox) || !bbox) return false;
  const [x, y, w, h] = bbox.map(Number);
  if (h < frame.height * 0.72) return false;
  if (y > frame.height * 0.16) return false;
  if (x < 0 || y < 0) return false;
  if (x + w > frame.width + 2 || y + h > frame.height + 2) return false;
  return true;
}

export function containFullFrame(frame: FrameSize): SubjectCrop {
  return containSubjectCrop({
    frameWidth: frame.width,
    frameHeight: frame.height,
    subject: { x: 0, y: 0, w: frame.width, h: frame.height },
  });
}

type CropLockScene = {
  camera_id: string;
  position?: number;
  crop?: number[];
  cropMode?: 'crop' | 'pad_blur';
  cropTight?: boolean;
  cropFilter?: string;
};

/** One live subject per camera. Dead YOLO boxes (feet, edge, short) do not replace a good take. */
export function lockScenesToLiveSubject<T extends CropLockScene>(
  scenes: T[],
  frameOf: (scene: T) => FrameSize | undefined,
): T[] {
  const locked = new Map<
    string,
    { crop: [number, number, number, number]; cropMode: 'crop' | 'pad_blur'; cropTight: boolean }
  >();
  for (const scene of scenes) {
    const frame = frameOf(scene) ?? { width: 1280, height: 720 };
    if (!isStandingDeliveryCrop(scene.crop, frame) || !scene.crop) continue;
    if (locked.has(scene.camera_id)) continue;
    const crop = scene.crop as [number, number, number, number];
    const cropMode: 'crop' | 'pad_blur' =
      scene.cropMode === 'pad_blur' || cropNeedsPadBlur({ crop }) ? 'pad_blur' : 'crop';
    locked.set(scene.camera_id, {
      crop,
      cropMode,
      cropTight: cropMode === 'pad_blur' ? true : Boolean(scene.cropTight),
    });
  }
  return scenes.map((scene) => {
    const frame = frameOf(scene) ?? { width: 1280, height: 720 };
    const keep = locked.get(scene.camera_id);
    if (keep) return { ...scene, ...keep, cropFilter: undefined };
    const fitted = containFullFrame(frame);
    return {
      ...scene,
      crop: fitted.bbox,
      cropMode: fitted.mode,
      cropTight: true,
      cropFilter: undefined,
    };
  });
}

export function pickStandingSubject(
  people: Array<{ bbox: [number, number, number, number]; is_full_body?: boolean }>,
): Box | null {
  if (!people.length) return null;
  const ranked = [...people].sort((a, b) => {
    const score = (row: (typeof people)[number]) => {
      const [, , w, h] = row.bbox;
      return w * h * (h > w * 1.15 ? 1.25 : 1) * (row.is_full_body ? 1.15 : 1);
    };
    return score(b) - score(a);
  });
  const [x, y, w, h] = ranked[0]!.bbox;
  return { x, y, w, h };
}

export function boxInSafeArea(box: Box, frame: FrameSize, safe: SafeArea = defaultSafeArea) {
  const left = frame.width * safe.left;
  const right = frame.width * (1 - safe.right);
  const top = frame.height * safe.top;
  const bottom = frame.height * (1 - safe.bottom);
  return box.x >= left && box.y >= top && box.x + box.w <= right && box.y + box.h <= bottom;
}

export function mapLegacyMotion(
  motion?: string,
  punchIn?: boolean,
): 'none' | 'slow_push' | 'punch_in' {
  if (motion === 'punch' || punchIn) return 'punch_in';
  if (motion === 'drift') return 'slow_push';
  return 'none';
}

export function mapLegacyTransition(
  transition?: string,
): 'hard_cut' | 'soft_dissolve' | 'dip_to_black' {
  if (transition === 'dissolve') return 'soft_dissolve';
  if (transition === 'fadeblack') return 'dip_to_black';
  return 'hard_cut';
}
