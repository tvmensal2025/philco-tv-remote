import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { channelRtspUrl } from './sofia.mjs';

describe('sofia configure urls', () => {
  it('builds Intelbras DVR channel paths without leaking into the host', () => {
    const url = channelRtspUrl({
      ip: '192.168.0.8',
      username: 'admin',
      password: 'p@ss',
      brand: 'intelbras',
      channel: 4,
    });
    assert.equal(url.includes('192.168.0.8'), true);
    assert.equal(url.includes('channel=4'), true);
    assert.equal(url.includes('p%40ss'), true);
  });
});
