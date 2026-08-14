import { describe, expect, it } from 'vitest';
import {
  applyCameraOffset,
  recordingOverlapsWindow,
  selectRecordingsForWindow,
  type WindowClip,
} from './recording-window.js';

const clip = (camera: string, start: string, end: string): WindowClip => ({
  object_key: `${camera}.mp4`,
  started_at: start,
  ended_at: end,
  duration_seconds: (Date.parse(end) - Date.parse(start)) / 1000,
  camera_id: camera,
});

describe('recording locator overlap', () => {
  const windowStart = Date.parse('2026-08-14T13:42:00-03:00');
  const windowEnd = Date.parse('2026-08-14T13:43:00-03:00');

  it('keeps a recording that started before the window and covers 13:42:00', () => {
    expect(
      recordingOverlapsWindow(
        Date.parse('2026-08-14T13:41:40-03:00'),
        Date.parse('2026-08-14T13:42:40-03:00'),
        windowStart,
        windowEnd,
      ),
    ).toBe(true);
  });

  it('drops a recording that starts after the window', () => {
    expect(
      recordingOverlapsWindow(
        Date.parse('2026-08-14T13:43:01-03:00'),
        Date.parse('2026-08-14T13:44:00-03:00'),
        windowStart,
        windowEnd,
      ),
    ).toBe(false);
  });

  it('applies a positive camera offset', () => {
    const shifted = applyCameraOffset(
      Date.parse('2026-08-14T13:42:05-03:00'),
      Date.parse('2026-08-14T13:43:05-03:00'),
      8_000,
    );
    expect(
      recordingOverlapsWindow(shifted.startedAt, shifted.endedAt, windowStart, windowEnd),
    ).toBe(true);
  });

  it('applies a negative camera offset', () => {
    const shifted = applyCameraOffset(
      Date.parse('2026-08-14T13:41:50-03:00'),
      Date.parse('2026-08-14T13:42:50-03:00'),
      -15_000,
    );
    expect(
      recordingOverlapsWindow(shifted.startedAt, shifted.endedAt, windowStart, windowEnd),
    ).toBe(true);
  });

  it('keeps several overlapping segments and skips a gap', () => {
    const selected = selectRecordingsForWindow(
      [
        clip('c1', '2026-08-14T13:41:00-03:00', '2026-08-14T13:41:30-03:00'),
        clip('c1', '2026-08-14T13:41:40-03:00', '2026-08-14T13:42:40-03:00'),
        clip('c1', '2026-08-14T13:42:40-03:00', '2026-08-14T13:43:10-03:00'),
        clip('c1', '2026-08-14T13:44:00-03:00', '2026-08-14T13:45:00-03:00'),
      ],
      0,
      windowStart,
      windowEnd,
      1,
    );
    expect(selected.map((row) => row.object_key)).toEqual(['c1.mp4', 'c1.mp4']);
    expect(selected.map((row) => row.started_at)).toEqual([
      '2026-08-14T13:41:40-03:00',
      '2026-08-14T13:42:40-03:00',
    ]);
  });

  it('returns no clips for a missing camera', () => {
    expect(selectRecordingsForWindow([], 0, windowStart, windowEnd, 9)).toEqual([]);
  });

  it('filters 16 cameras independently', () => {
    const cameras = Array.from({ length: 16 }, (_, index) => {
      const position = index + 1;
      const start = position === 16 ? '2026-08-14T13:50:00-03:00' : '2026-08-14T13:41:40-03:00';
      const end = position === 16 ? '2026-08-14T13:51:00-03:00' : '2026-08-14T13:42:40-03:00';
      return {
        position,
        selected: selectRecordingsForWindow(
          [clip(`c${position}`, start, end)],
          0,
          windowStart,
          windowEnd,
          position,
        ),
      };
    });
    expect(cameras.filter((item) => item.selected.length).map((item) => item.position)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(cameras[15]?.selected).toEqual([]);
  });
});
