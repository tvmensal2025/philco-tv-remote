import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCompactStamp,
  redactRtsp,
  rtspFfmpegArgs,
  rtspIdentity,
  rtspSegmentName,
} from './rtsp.mjs';

describe('rtsp capture', () => {
  it('names segments with the canonical filename timestamp', () => {
    const startedAt = new Date('2026-08-14T16:42:00.000Z');
    const endedAt = new Date('2026-08-14T16:43:00.000Z');
    assert.equal(
      rtspSegmentName({ position: 1, startedAt, endedAt, timezoneOffset: '-03:00' }),
      'cam-01_20260814T134200_20260814T134300.mp4',
    );
    assert.equal(formatCompactStamp(startedAt, '-03:00'), '20260814T134200');
  });

  it('copies video and transcodes audio so Intelbras G.711 does not break the mp4', () => {
    const args = rtspFfmpegArgs({
      url: 'rtsp://admin:secret@192.168.0.20:554/stream1',
      output: 'cam-01.mp4',
      segmentSeconds: 60,
      transport: 'tcp',
    });
    assert.equal(args.includes('-c:v'), true);
    assert.equal(args.includes('copy'), true);
    assert.equal(args.includes('-c:a'), true);
    assert.equal(args.includes('aac'), true);
    assert.equal(args.includes('-stimeout'), true);
    assert.equal(args.includes('-timeout'), false);
    assert.equal(args.at(-1), 'cam-01.mp4');
  });

  it('never puts the live URL into identity or log redaction leftovers', () => {
    const url = 'rtsp://admin:segredo@10.0.0.2:554/live';
    assert.equal(rtspIdentity(url), '10.0.0.2:554/live');
    assert.equal(redactRtsp(`Opening '${url}' for reading`).includes('segredo'), false);
  });
});
