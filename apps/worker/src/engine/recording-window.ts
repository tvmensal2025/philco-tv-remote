export function recordingOverlapsWindow(
  startedAt: number,
  endedAt: number,
  windowStart: number,
  windowEnd: number,
) {
  return startedAt < windowEnd && endedAt > windowStart;
}

export function applyCameraOffset(startedAtMs: number, endedAtMs: number, offsetMs: number) {
  return { startedAt: startedAtMs - offsetMs, endedAt: endedAtMs - offsetMs };
}

export type WindowClip = {
  id?: string;
  object_key: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number | null;
  camera_id: string;
};

export type LocatedRecording = {
  id?: string;
  object_key: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number | null;
  camera_id: string;
  position: number;
};

export function selectRecordingsForWindow(
  rows: WindowClip[],
  offsetMs: number,
  windowStart: number,
  windowEnd: number,
  position: number,
): LocatedRecording[] {
  return rows
    .map((row) => {
      const shifted = applyCameraOffset(
        Date.parse(row.started_at),
        Date.parse(row.ended_at),
        offsetMs,
      );
      return { ...row, ...shifted };
    })
    .filter(
      (row) =>
        Number.isFinite(row.startedAt) &&
        Number.isFinite(row.endedAt) &&
        recordingOverlapsWindow(row.startedAt, row.endedAt, windowStart, windowEnd),
    )
    .map((row) => ({
      id: row.id,
      object_key: row.object_key,
      started_at: row.started_at,
      ended_at: row.ended_at,
      duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
      camera_id: row.camera_id,
      position,
    }));
}
