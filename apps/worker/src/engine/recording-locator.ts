import { db } from '../services.js';
import { config } from '../config.js';
import {
  selectRecordingsForWindow,
  type LocatedRecording,
  type WindowClip,
} from './recording-window.js';

export type { LocatedRecording, WindowClip } from './recording-window.js';
export {
  applyCameraOffset,
  recordingOverlapsWindow,
  selectRecordingsForWindow,
} from './recording-window.js';

export type CameraTimeline = {
  cameraId: string;
  position: number;
  offsetMs: number;
  recordings: LocatedRecording[];
};

export type MultiCameraTimeline = {
  restaurantId: string;
  windowStart: string;
  windowEnd: string;
  cameras: CameraTimeline[];
};

export async function locateRecordings(input: {
  tenantId: string;
  restaurantId: string;
  windowStart: string;
  windowEnd: string;
}): Promise<MultiCameraTimeline> {
  const windowStart = Date.parse(input.windowStart);
  const windowEnd = Date.parse(input.windowEnd);
  const { data: cameras, error } = await db
    .from('cameras')
    .select('id,position,camera_time_offset_ms')
    .eq('tenant_id', input.tenantId)
    .eq('restaurant_id', input.restaurantId)
    .eq('enabled', true)
    .order('position');
  const cameraRows = error
    ? ((
        await db
          .from('cameras')
          .select('id,position')
          .eq('tenant_id', input.tenantId)
          .eq('restaurant_id', input.restaurantId)
          .eq('enabled', true)
          .order('position')
      ).data ?? [])
    : (cameras ?? []);

  const timelines: CameraTimeline[] = [];
  for (const camera of cameraRows) {
    const offsetMs = Number(
      (camera as { camera_time_offset_ms?: number }).camera_time_offset_ms ?? 0,
    );
    const queryStart = new Date(
      windowStart + offsetMs - config.NVR_SEGMENT_SECONDS * 1000,
    ).toISOString();
    const queryEnd = new Date(windowEnd + offsetMs).toISOString();
    const { data: rows, error: recordingError } = await db
      .from('recordings')
      .select('id,object_key,started_at,ended_at,duration_seconds,camera_id')
      .eq('tenant_id', input.tenantId)
      .eq('restaurant_id', input.restaurantId)
      .eq('camera_id', camera.id)
      .lt('started_at', queryEnd)
      .gt('ended_at', queryStart)
      .order('started_at', { ascending: true });
    if (recordingError) throw recordingError;

    const recordings = selectRecordingsForWindow(
      (rows ?? []) as WindowClip[],
      offsetMs,
      windowStart,
      windowEnd,
      Number(camera.position),
    );

    timelines.push({
      cameraId: camera.id as string,
      position: Number(camera.position),
      offsetMs,
      recordings,
    });
  }

  return {
    restaurantId: input.restaurantId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    cameras: timelines,
  };
}
