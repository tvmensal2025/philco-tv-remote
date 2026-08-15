import { describe, expect, it } from 'vitest';
import {
  buildRtspUrl,
  formatRtspUrl,
  ingestModeOf,
  intelbrasRtspPath,
  maskRtspUrl,
  mergeRtspUrl,
  parseRtspUrl,
  publicCameraSource,
  redactRtsp,
  sourceTypeForMode,
} from './rtsp.js';

describe('rtsp url helpers', () => {
  it('parses a password that contains @ without eating the host', () => {
    const parsed = parseRtspUrl(
      'rtsp://admin:p@ss@192.168.0.20:554/cam/realmonitor?channel=1&subtype=0',
    );
    expect(parsed?.host).toBe('192.168.0.20');
    expect(parsed?.password).toBe('p@ss');
    expect(parsed?.path).toContain('channel=1');
  });

  it('masks the password so the dashboard never shows the secret', () => {
    expect(maskRtspUrl('rtsp://admin:secret@192.168.0.20:554/stream1')).toBe(
      'rtsp://admin:****@192.168.0.20:554/stream1',
    );
  });

  it('keeps the previous password when the form sends a masked url', () => {
    const merged = mergeRtspUrl(
      'rtsp://admin:****@192.168.0.21:554/stream1',
      'rtsp://admin:secret@192.168.0.20:554/stream1',
    );
    expect(parseRtspUrl(merged)?.host).toBe('192.168.0.21');
    expect(parseRtspUrl(merged)?.password).toBe('secret');
  });

  it('builds the intelbras dvr url used in commerce installs', () => {
    expect(intelbrasRtspPath(3)).toBe('/cam/realmonitor?channel=3&subtype=0');
    const url = buildRtspUrl({
      host: '192.168.0.8',
      username: 'admin',
      password: 'casa',
      brand: 'intelbras',
      channel: 2,
    });
    expect(url).toContain('192.168.0.8');
    expect(url).toContain('channel=2');
    expect(parseRtspUrl(url)?.password).toBe('casa');
  });

  it('redacts secrets from ffmpeg logs', () => {
    expect(redactRtsp("Opening 'rtsp://admin:segredo@10.0.0.2/live' for reading")).toBe(
      "Opening 'rtsp://***' for reading",
    );
  });

  it('roundtrips encode of special characters', () => {
    const url = formatRtspUrl({
      protocol: 'rtsp',
      username: 'admin',
      password: 'p@ss',
      host: '10.0.0.8',
      port: '554',
      path: '/cam/realmonitor?channel=1&subtype=0',
    });
    expect(parseRtspUrl(url)?.password).toBe('p@ss');
  });
});

describe('camera ingest mode', () => {
  it('maps the three client setups', () => {
    expect(ingestModeOf('rtsp', {})).toBe('rtsp');
    expect(ingestModeOf('minio', { ingestMode: 'phone' })).toBe('phone');
    expect(ingestModeOf('nvr', {})).toBe('folder');
    expect(sourceTypeForMode('rtsp')).toBe('rtsp');
    expect(sourceTypeForMode('phone')).toBe('minio');
    expect(sourceTypeForMode('folder', 'minio')).toBe('minio');
  });

  it('never returns the live password to the browser', () => {
    const publicSource = publicCameraSource('rtsp', {
      ingestMode: 'rtsp',
      rtspUrl: 'rtsp://admin:secret@192.168.0.20/live',
      rtspHost: '192.168.0.20',
      rtspHasPassword: true,
    });
    expect(JSON.stringify(publicSource)).not.toContain('secret');
    expect(publicSource.rtspHasPassword).toBe(true);
    expect(publicSource.ingestMode).toBe('rtsp');
  });
});
