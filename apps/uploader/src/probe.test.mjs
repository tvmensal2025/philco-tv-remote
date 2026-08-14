import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertCompleteMedia, parseProbe } from './probe.mjs';

describe('complete media gate', () => {
  it('rejects a container without a video stream', () => {
    assert.throws(
      () =>
        assertCompleteMedia(
          parseProbe({ format: { duration: '12.0' }, streams: [{ codec_type: 'audio' }] }),
        ),
      /INCOMPLETE_MEDIA/,
    );
  });

  it('rejects duration 0', () => {
    assert.throws(
      () =>
        assertCompleteMedia(
          parseProbe({
            format: { duration: '0' },
            streams: [{ codec_type: 'video', codec_name: 'h264' }],
          }),
        ),
      /INCOMPLETE_MEDIA/,
    );
  });

  it('accepts a readable video stream with duration', () => {
    const probe = parseProbe({
      format: { duration: '45.2', tags: { creation_time: '2026-08-14T16:42:00.000Z' } },
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }],
    });
    assert.equal(assertCompleteMedia(probe).hasVideo, true);
    assert.equal(probe.duration, 45.2);
    assert.equal(probe.creationTime, '2026-08-14T16:42:00.000Z');
  });
});
