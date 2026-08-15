export type BBox = [number, number, number, number];

export type Detection = {
  trackId?: number | null;
  detectorClass: string;
  semanticRole?: 'chef' | 'server' | 'guest' | 'food' | 'plate' | 'unknown';
  confidence: number;
  bbox: BBox;
};

export type CropKeyframe = {
  timeMs: number;
  centerX: number;
  centerY: number;
  scale: number;
};

export type CropTrajectory = {
  strategy: 'static' | 'tracked_subject' | 'food_and_person' | 'wide_safe';
  keyframes: CropKeyframe[];
  frameWidth: number;
  frameHeight: number;
};

export const CROP_LIMITS = {
  MAX_CROP_SPEED: 420,
  MAX_CROP_ACCELERATION: 1800,
  MAX_ZOOM_SPEED: 0.35,
  MAX_ZOOM_ACCELERATION: 1.2,
  DEAD_ZONE_PX: 28,
  EMA_ALPHA: 0.28,
};

export function boxCenter(bbox: BBox): { x: number; y: number; w: number; h: number } {
  const [x, y, w, h] = bbox;
  return { x: x + w / 2, y: y + h / 2, w, h };
}

export function boxArea(bbox: BBox) {
  return Math.max(0, bbox[2]) * Math.max(0, bbox[3]);
}

export function unionBox(a: BBox, b: BBox): BBox {
  const x1 = Math.min(a[0], b[0]);
  const y1 = Math.min(a[1], b[1]);
  const x2 = Math.max(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.max(a[1] + a[3], b[1] + b[3]);
  return [x1, y1, x2 - x1, y2 - y1];
}

export function cropWindow9x16(
  frameWidth: number,
  frameHeight: number,
  centerX: number,
  centerY: number,
  scale = 1,
): BBox {
  const target = 9 / 16;
  const zoom = Math.min(1.28, Math.max(1, scale));
  let cropH = frameHeight / zoom;
  let cropW = cropH * target;
  if (cropW > frameWidth) {
    cropW = frameWidth / zoom;
    cropH = cropW / target;
  }
  cropW = Math.max(16, Math.min(frameWidth, Math.round(cropW / 2) * 2));
  cropH = Math.max(16, Math.min(frameHeight, Math.round(cropH / 2) * 2));
  let x = Math.round(centerX - cropW / 2);
  let y = Math.round(centerY - cropH / 2);
  x = Math.max(0, Math.min(frameWidth - cropW, x));
  y = Math.max(0, Math.min(frameHeight - cropH, y));
  return [x, y, cropW, cropH];
}

export function foodAwareTarget(input: {
  people: Detection[];
  food: Detection[];
  frameWidth: number;
  frameHeight: number;
  sceneRole?: string;
  shotStyle?: string;
}): { x: number; y: number; strategy: CropTrajectory['strategy']; subject: Detection | null } {
  const people = [...input.people].sort((a, b) => boxArea(b.bbox) - boxArea(a.bbox));
  const food = [...input.food].sort((a, b) => boxArea(b.bbox) - boxArea(a.bbox));
  const foodScene = /food|plating|serving|craft|dish|hero/i.test(
    `${input.sceneRole ?? ''} ${input.shotStyle ?? ''}`,
  );
  if (people[0] && food[0] && (foodScene || input.shotStyle === 'cinematic_food_closeup')) {
    const person = boxCenter(people[0].bbox);
    const dish = boxCenter(food[0].bbox);
    return {
      x: person.x * 0.55 + dish.x * 0.45,
      y: person.y * 0.45 + dish.y * 0.55,
      strategy: 'food_and_person',
      subject: people[0],
    };
  }
  if (food[0] && (!people[0] || foodScene)) {
    const dish = boxCenter(food[0].bbox);
    return { x: dish.x, y: dish.y, strategy: 'static', subject: food[0] };
  }
  if (people[0]) {
    const person = boxCenter(people[0].bbox);
    return { x: person.x, y: person.y * 0.92, strategy: 'tracked_subject', subject: people[0] };
  }
  return {
    x: input.frameWidth / 2,
    y: input.frameHeight / 2,
    strategy: 'wide_safe',
    subject: null,
  };
}

export type TrackObservation = {
  timeMs: number;
  trackId: number;
  bbox: BBox;
  confidence: number;
  className: string;
};

export function lockSubject(
  observations: TrackObservation[],
  options?: { margin?: number; minLockMs?: number },
) {
  const margin = options?.margin ?? 0.22;
  const minLockMs = options?.minLockMs ?? 900;
  const byId = new Map<number, TrackObservation[]>();
  for (const row of observations) {
    const list = byId.get(row.trackId) ?? [];
    list.push(row);
    byId.set(row.trackId, list);
  }
  const scored = [...byId.entries()].map(([trackId, rows]) => {
    const duration = (rows.at(-1)?.timeMs ?? 0) - (rows[0]?.timeMs ?? 0);
    const meanArea = rows.reduce((sum, row) => sum + boxArea(row.bbox), 0) / rows.length;
    const meanConf = rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length;
    const food = rows.some((row) =>
      /bowl|pizza|cake|sandwich|dining table|cup/i.test(row.className),
    );
    const score =
      Math.sqrt(meanArea) * meanConf * (1 + Math.min(1, duration / 2000)) * (food ? 1.2 : 1);
    return { trackId, score, duration, rows };
  });
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  if (!winner)
    return { trackId: null as number | null, switches: 0, locked: [] as TrackObservation[] };
  let lockedId = winner.trackId;
  let switches = 0;
  let pending: { trackId: number; since: number } | null = null;
  const locked: TrackObservation[] = [];
  const times = [...new Set(observations.map((row) => row.timeMs))].sort((a, b) => a - b);
  for (const timeMs of times) {
    const present = observations.filter((row) => row.timeMs === timeMs);
    const current = present.find((row) => row.trackId === lockedId);
    const challenger = present
      .filter((row) => row.trackId !== lockedId)
      .sort((a, b) => boxArea(b.bbox) * b.confidence - boxArea(a.bbox) * a.confidence)[0];
    if (challenger && current) {
      const better =
        boxArea(challenger.bbox) * challenger.confidence >
        boxArea(current.bbox) * current.confidence * (1 + margin);
      if (better) {
        pending ??= { trackId: challenger.trackId, since: timeMs };
        if (pending.trackId === challenger.trackId && timeMs - pending.since >= minLockMs) {
          lockedId = challenger.trackId;
          switches += 1;
          pending = null;
        }
      } else pending = null;
    } else if (!current && challenger) {
      lockedId = challenger.trackId;
      switches += 1;
    }
    const chosen = present.find((row) => row.trackId === lockedId) ?? current ?? challenger;
    if (chosen) locked.push(chosen);
  }
  return { trackId: lockedId, switches, locked };
}

export function smoothCropTrajectory(
  points: Array<{ timeMs: number; x: number; y: number; scale?: number }>,
  frame: { width: number; height: number },
  strategy: CropTrajectory['strategy'] = 'tracked_subject',
): CropTrajectory {
  if (!points.length) {
    return {
      strategy: 'static',
      frameWidth: frame.width,
      frameHeight: frame.height,
      keyframes: [{ timeMs: 0, centerX: frame.width / 2, centerY: frame.height / 2, scale: 1 }],
    };
  }
  if (strategy === 'static' || strategy === 'wide_safe') {
    const mid = points[Math.floor(points.length / 2)]!;
    return {
      strategy,
      frameWidth: frame.width,
      frameHeight: frame.height,
      keyframes: [{ timeMs: points[0]!.timeMs, centerX: mid.x, centerY: mid.y, scale: 1 }],
    };
  }
  const keyframes: CropKeyframe[] = [];
  let prevX = points[0]!.x;
  let prevY = points[0]!.y;
  let prevScale = points[0]!.scale ?? 1;
  let prevVx = 0;
  let prevVy = 0;
  let prevT = points[0]!.timeMs;
  for (const point of points) {
    const dt = Math.max(1, point.timeMs - prevT) / 1000;
    let x = point.x;
    let y = point.y;
    const scale = Math.min(1.22, Math.max(1, point.scale ?? 1));
    if (Math.hypot(x - prevX, y - prevY) < CROP_LIMITS.DEAD_ZONE_PX) {
      x = prevX;
      y = prevY;
    } else {
      x = prevX + CROP_LIMITS.EMA_ALPHA * (x - prevX);
      y = prevY + CROP_LIMITS.EMA_ALPHA * (y - prevY);
    }
    let vx = (x - prevX) / dt;
    let vy = (y - prevY) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed > CROP_LIMITS.MAX_CROP_SPEED) {
      const k = CROP_LIMITS.MAX_CROP_SPEED / speed;
      vx *= k;
      vy *= k;
      x = prevX + vx * dt;
      y = prevY + vy * dt;
    }
    const ax = (vx - prevVx) / dt;
    const ay = (vy - prevVy) / dt;
    if (Math.hypot(ax, ay) > CROP_LIMITS.MAX_CROP_ACCELERATION) {
      x = prevX + prevVx * dt;
      y = prevY + prevVy * dt;
    }
    let nextScale = prevScale + CROP_LIMITS.EMA_ALPHA * (scale - prevScale);
    const zoomSpeed = Math.abs(nextScale - prevScale) / dt;
    if (zoomSpeed > CROP_LIMITS.MAX_ZOOM_SPEED) {
      nextScale = prevScale + Math.sign(nextScale - prevScale) * CROP_LIMITS.MAX_ZOOM_SPEED * dt;
    }
    keyframes.push({ timeMs: point.timeMs, centerX: x, centerY: y, scale: nextScale });
    prevVx = (x - prevX) / dt;
    prevVy = (y - prevY) / dt;
    prevX = x;
    prevY = y;
    prevScale = nextScale;
    prevT = point.timeMs;
  }
  const sparse = sparsifyKeyframes(keyframes);
  return { strategy, frameWidth: frame.width, frameHeight: frame.height, keyframes: sparse };
}

export function sparsifyKeyframes(frames: CropKeyframe[], minDeltaPx = 12, minDtMs = 180) {
  if (frames.length <= 2) return frames;
  const out = [frames[0]!];
  for (const frame of frames.slice(1, -1)) {
    const last = out[out.length - 1]!;
    if (
      frame.timeMs - last.timeMs >= minDtMs &&
      Math.hypot(frame.centerX - last.centerX, frame.centerY - last.centerY) >= minDeltaPx
    ) {
      out.push(frame);
    }
  }
  out.push(frames[frames.length - 1]!);
  return out;
}

export function interpolateKeyframe(trajectory: CropTrajectory, timeMs: number): CropKeyframe {
  const frames = trajectory.keyframes;
  if (!frames.length) {
    return {
      timeMs,
      centerX: trajectory.frameWidth / 2,
      centerY: trajectory.frameHeight / 2,
      scale: 1,
    };
  }
  if (timeMs <= frames[0]!.timeMs) return frames[0]!;
  const last = frames[frames.length - 1]!;
  if (timeMs >= last.timeMs) return last;
  const nextIndex = frames.findIndex((frame) => frame.timeMs >= timeMs);
  const b = frames[nextIndex]!;
  const a = frames[nextIndex - 1]!;
  const t = (timeMs - a.timeMs) / Math.max(1, b.timeMs - a.timeMs);
  return {
    timeMs,
    centerX: a.centerX + (b.centerX - a.centerX) * t,
    centerY: a.centerY + (b.centerY - a.centerY) * t,
    scale: a.scale + (b.scale - a.scale) * t,
  };
}

export function ffmpegCropFromTrajectory(trajectory: CropTrajectory, durationSeconds: number) {
  const frames = trajectory.keyframes;
  if (frames.length <= 1) {
    const key = frames[0] ?? {
      timeMs: 0,
      centerX: trajectory.frameWidth / 2,
      centerY: trajectory.frameHeight / 2,
      scale: 1,
    };
    const [x, y, w, h] = cropWindow9x16(
      trajectory.frameWidth,
      trajectory.frameHeight,
      key.centerX,
      key.centerY,
      key.scale,
    );
    return `crop=${w}:${h}:${x}:${y}`;
  }
  const boxes = frames.map((frame) => {
    const box = cropWindow9x16(
      trajectory.frameWidth,
      trajectory.frameHeight,
      frame.centerX,
      frame.centerY,
      frame.scale,
    );
    return { t: frame.timeMs / 1000, x: box[0], y: box[1], w: box[2], h: box[3] };
  });
  const w = boxes[0]!.w;
  const h = boxes[0]!.h;
  const xExpr = piecewiseExpr(
    boxes.map((box) => box.t),
    boxes.map((box) => box.x),
    durationSeconds,
  );
  const yExpr = piecewiseExpr(
    boxes.map((box) => box.t),
    boxes.map((box) => box.y),
    durationSeconds,
  );
  return `crop=${w}:${h}:'trunc((${xExpr})/2)*2':'trunc((${yExpr})/2)*2'`;
}

function piecewiseExpr(times: number[], values: number[], durationSeconds: number) {
  if (times.length === 1) return String(values[0]);
  let expr = String(values[values.length - 1]);
  for (let i = times.length - 2; i >= 0; i -= 1) {
    const t0 = times[i]!;
    const t1 = times[i + 1]!;
    const v0 = values[i]!;
    const v1 = values[i + 1]!;
    const span = Math.max(0.05, t1 - t0);
    expr = `if(lt(t\\,${t1.toFixed(3)}),${v0}+(${v1}-${v0})*clip((t-${t0.toFixed(3)})/${span.toFixed(3)}\\,0\\,1),${expr})`;
  }
  void durationSeconds;
  return expr;
}

export type CameraRankInput = {
  cameraPosition: number;
  cameraRole: string;
  visionScore?: number | null;
  foodVisibility: number;
  personVisibility: number;
  lighting: number;
  blur: number;
  occlusion: number;
  cropFeasibility: number;
  trackingStability: number;
  actionCompleteness: number;
  watermark?: boolean;
  brandMismatch?: boolean;
  coherenceWithPrimary?: number;
  semanticRelevance?: number;
};

export type RankedCamera = CameraRankInput & { score: number };

export function rankCameras(cameras: CameraRankInput[]): RankedCamera[] {
  const ranked = cameras.map((camera) => {
    const darkPenalty = camera.lighting < 0.22 ? 28 : camera.lighting < 0.35 ? 12 : 0;
    const brandPenalty = camera.watermark || camera.brandMismatch ? 40 : 0;
    const coherenceBoost = Math.min(8, (camera.coherenceWithPrimary ?? 50) * 0.08);
    const rolePrior =
      camera.cameraRole === 'food'
        ? 4
        : camera.cameraRole === 'master'
          ? 4
          : camera.cameraRole === 'side'
            ? 2
            : 1;
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          camera.foodVisibility * 20 +
            camera.personVisibility * 16 +
            camera.lighting * 16 +
            (1 - camera.blur) * 10 +
            (1 - camera.occlusion) * 8 +
            camera.cropFeasibility * 8 +
            camera.trackingStability * 4 +
            camera.actionCompleteness * 6 +
            (camera.semanticRelevance ?? camera.visionScore ?? 50) * 0.1 +
            rolePrior +
            coherenceBoost -
            darkPenalty -
            brandPenalty,
        ),
      ),
    );
    return { ...camera, score };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

export function snapCut(input: {
  proposedMs: number;
  windowStartMs: number;
  windowEndMs: number;
  motion: Array<{ timeMs: number; energy: number }>;
  searchMs?: number;
}) {
  const search = input.searchMs ?? 400;
  const lo = Math.max(input.windowStartMs, input.proposedMs - search);
  const hi = Math.min(input.windowEndMs, input.proposedMs + search);
  const samples = input.motion.filter((row) => row.timeMs >= lo && row.timeMs <= hi);
  if (!samples.length) return { timeMs: input.proposedMs, changed: false };
  const safest = samples.reduce((best, row) => (row.energy < best.energy ? row : best));
  const current = samples.find((row) => Math.abs(row.timeMs - input.proposedMs) < 40) ?? {
    timeMs: input.proposedMs,
    energy: safest.energy + 1,
  };
  if (safest.energy < current.energy * 0.72) {
    return { timeMs: safest.timeMs, changed: safest.timeMs !== input.proposedMs };
  }
  return { timeMs: input.proposedMs, changed: false };
}

export function meanLuma(bytes: Uint8Array) {
  if (!bytes.length) return 0;
  let sum = 0;
  for (const value of bytes) sum += value;
  return sum / bytes.length / 255;
}

export function trackingQualityReport(input: {
  locked: TrackObservation[];
  switches: number;
  foodHits: number;
  samples: number;
  keyframes: CropKeyframe[];
  lostMs: number;
}) {
  const subjectRetention = input.samples ? input.locked.length / input.samples : 0;
  const foodRetention = input.samples ? input.foodHits / input.samples : 0;
  let maxSpeed = 0;
  let jitter = 0;
  for (let i = 1; i < input.keyframes.length; i += 1) {
    const a = input.keyframes[i - 1]!;
    const b = input.keyframes[i]!;
    const dt = Math.max(0.05, (b.timeMs - a.timeMs) / 1000);
    const speed = Math.hypot(b.centerX - a.centerX, b.centerY - a.centerY) / dt;
    maxSpeed = Math.max(maxSpeed, speed);
    jitter += Math.hypot(b.centerX - a.centerX, b.centerY - a.centerY);
  }
  const cropJitterScore = input.keyframes.length > 1 ? jitter / (input.keyframes.length - 1) : 0;
  const fail =
    subjectRetention < 0.45 || input.switches > 4 || cropJitterScore > 80 || maxSpeed > 900;
  return {
    subjectRetention: Number(subjectRetention.toFixed(3)),
    foodRetention: Number(foodRetention.toFixed(3)),
    subjectSwitchCount: input.switches,
    lostTrackDurationMs: input.lostMs,
    cropJitterScore: Number(cropJitterScore.toFixed(2)),
    maxCropSpeed: Number(maxSpeed.toFixed(1)),
    fallbackStatic: fail,
  };
}

export function shotStyleMotion(
  shotStyle: string | undefined,
  durationSeconds: number,
): { kind: 'none' | 'slow_push' | 'punch'; zoom: number } {
  if (shotStyle === 'punch_in') return { kind: 'punch', zoom: 1.12 };
  if (
    shotStyle === 'slow_push' ||
    shotStyle === 'cinematic_food_closeup' ||
    shotStyle === 'hero_reveal'
  ) {
    return { kind: 'slow_push', zoom: durationSeconds >= 3 ? 1.07 : 1.05 };
  }
  return { kind: 'none', zoom: 1 };
}
