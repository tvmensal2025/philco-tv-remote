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
    const cropW = Math.max(2, Math.floor((height * TARGET_AR) / 2) * 2);
    const x = Math.max(0, Math.floor((width - cropW) / 2));
    return {
      mode: 'crop',
      filter: `crop=${cropW}:${height}:${x}:0,scale=${TARGET_W}:${TARGET_H}`,
    };
  }
  const cropH = Math.max(2, Math.floor(width / TARGET_AR / 2) * 2);
  const y = Math.max(0, Math.floor((height - cropH) / 2));
  return {
    mode: 'crop',
    filter: `crop=${width}:${cropH}:0:${y},scale=${TARGET_W}:${TARGET_H}`,
  };
}

export const defaultSafeArea = { top: 0.12, bottom: 0.14, left: 0.06, right: 0.06 };

export type Box = { x: number; y: number; w: number; h: number };
export type FrameSize = { width: number; height: number };
export type SafeArea = typeof defaultSafeArea;

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
