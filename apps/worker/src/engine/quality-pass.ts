import {
  containSubjectCrop,
  ffmpegCropFromTrajectory,
  foodAwareTarget,
  lockSubject,
  mapBoxToFrame,
  pickStandingSubject,
  rankCameras,
  smoothCropTrajectory,
  snapCut,
  trackingQualityReport,
  type CameraRankInput,
  type RankedCamera,
  type Detection,
  type FrameSize,
  type TrackObservation,
} from '@reelops/shared';
import type { ReelPlan, ReelPlanScene } from './planner.js';
import type { PeakHit } from './peak-snap.js';

export function scoresFromRanker(rows: RankedCamera[] | CameraRankInput[]) {
  const ranked =
    rows[0] && 'score' in rows[0]
      ? (rows as RankedCamera[])
      : rankCameras(rows as CameraRankInput[]);
  return new Map(ranked.map((row) => [row.cameraPosition, row.score]));
}

export function applyCutSafety(
  scenes: ReelPlanScene[],
  peaksByCamera: Map<string, PeakHit[]>,
  windowByCamera: Map<string, { start: number; duration: number }>,
) {
  return scenes.map((scene) => {
    const window = windowByCamera.get(scene.camera_id);
    if (!window) return scene;
    const motion = (peaksByCamera.get(scene.camera_id) ?? []).map((peak) => ({
      timeMs: Math.round(peak.offsetSeconds * 1000),
      energy: peak.fusedScore,
    }));
    const start = snapCut({
      proposedMs: Math.round(scene.source_start_offset * 1000),
      windowStartMs: Math.round(window.start * 1000),
      windowEndMs: Math.round((window.start + window.duration) * 1000),
      motion,
    });
    const nextStart = start.timeMs / 1000;
    const maxEnd = window.start + window.duration;
    const duration = Math.min(scene.duration, Math.max(0.8, maxEnd - nextStart));
    return { ...scene, source_start_offset: nextStart, duration };
  });
}

export function mapDetectionsToSource<T extends { bbox: [number, number, number, number] }>(
  rows: T[],
  from?: FrameSize,
  to?: FrameSize,
): T[] {
  if (!from || !to || !rows.length) return rows;
  if (Math.abs(from.width - to.width) < 2 && Math.abs(from.height - to.height) < 2) return rows;
  return rows.map((row) => {
    const mapped = mapBoxToFrame(
      { x: row.bbox[0], y: row.bbox[1], w: row.bbox[2], h: row.bbox[3] },
      from,
      to,
    );
    return {
      ...row,
      bbox: [mapped.x, mapped.y, mapped.w, mapped.h] as [number, number, number, number],
    };
  });
}

export function applySmartReframe(
  scene: ReelPlanScene,
  input: {
    people: Detection[];
    food: Detection[];
    tracks: TrackObservation[];
    frameWidth: number;
    frameHeight: number;
    enableTracking: boolean;
  },
) {
  if (scene.cropMode === 'pad_blur' || scene.cropTight) return scene;
  if (!input.people.length && !input.food.length && !input.tracks.length) {
    return scene;
  }
  const target = foodAwareTarget({
    people: input.people,
    food: input.food,
    frameWidth: input.frameWidth,
    frameHeight: input.frameHeight,
    sceneRole: scene.role,
    shotStyle: scene.shotStyle,
  });
  const standing = pickStandingSubject(
    input.people.map((row) => ({
      bbox: row.bbox,
      is_full_body: /person|chef|server|guest/i.test(row.detectorClass),
    })),
  );
  const dish = input.food[0]
    ? {
        x: input.food[0].bbox[0],
        y: input.food[0].bbox[1],
        w: input.food[0].bbox[2],
        h: input.food[0].bbox[3],
      }
    : null;
  let subject = standing;
  if (target.strategy === 'food_and_person' && standing && dish) {
    const x = Math.min(standing.x, dish.x);
    const y = Math.min(standing.y, dish.y);
    subject = {
      x,
      y,
      w: Math.max(standing.x + standing.w, dish.x + dish.w) - x,
      h: Math.max(standing.y + standing.h, dish.y + dish.h) - y,
    };
  } else if (!subject && dish) {
    subject = dish;
  } else if (!subject && target.subject) {
    const [x, y, w, h] = target.subject.bbox;
    subject = { x, y, w, h };
  }
  if (!subject) return scene;
  const fitted = containSubjectCrop({
    frameWidth: input.frameWidth,
    frameHeight: input.frameHeight,
    subject,
  });
  const locked = input.enableTracking
    ? lockSubject(input.tracks)
    : { trackId: null, switches: 0, locked: [] as TrackObservation[] };
  const points = locked.locked.length
    ? locked.locked.map((row) => ({
        timeMs: row.timeMs,
        x: row.bbox[0] + row.bbox[2] / 2,
        y: row.bbox[1] + row.bbox[3] / 2,
      }))
    : [{ timeMs: 0, x: target.x, y: target.y }];
  const strategy =
    fitted.mode === 'pad_blur' ||
    fitted.tight ||
    scene.shotStyle === 'locked_static' ||
    scene.shotStyle === 'ambient_wide'
      ? 'static'
      : target.strategy;
  const trajectory = smoothCropTrajectory(
    points,
    { width: input.frameWidth, height: input.frameHeight },
    strategy,
  );
  const qc = trackingQualityReport({
    locked: locked.locked,
    switches: locked.switches,
    foodHits: input.food.length,
    samples: Math.max(1, input.tracks.length || points.length),
    keyframes: trajectory.keyframes,
    lostMs: 0,
  });
  const safe = qc.fallbackStatic
    ? smoothCropTrajectory(points, { width: input.frameWidth, height: input.frameHeight }, 'static')
    : trajectory;
  const still = fitted.mode === 'pad_blur' || fitted.tight || !input.enableTracking;
  return {
    ...scene,
    crop: fitted.bbox,
    cropMode: fitted.mode,
    cropTight: fitted.tight,
    cropFilter: still ? undefined : ffmpegCropFromTrajectory(safe, scene.duration),
    motion: fitted.tight ? 'none' : scene.motion,
    reframe: {
      strategy: fitted.mode === 'pad_blur' ? 'wide_safe' : safe.strategy,
      qc,
      trackId: locked.trackId,
    },
  };
}

export function visionScoreForCamera(
  rankings: Array<{ camera?: string; score?: number }> | undefined,
  position: number,
) {
  const row = rankings?.find((item) => String(item.camera ?? '').toUpperCase() === `C${position}`);
  return typeof row?.score === 'number' ? row.score : null;
}
