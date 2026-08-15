import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDevice, subnetHosts } from './discover.mjs';

describe('sofia discovery', () => {
  it('treats an Intelbras MHDX with RTSP as the house DVR', () => {
    const device = classifyDevice({
      ip: '192.168.0.8',
      ports: [554, 80],
      httpHint: 'Intelbras MHDX 1108',
    });
    assert.equal(device.kind, 'dvr');
    assert.equal(device.brand, 'intelbras');
    assert.match(device.name, /192\.168\.0\.8/);
  });

  it('marks XM/iCSee boxes without RTSP as app-locked', () => {
    const device = classifyDevice({
      ip: '192.168.0.44',
      ports: [34567],
    });
    assert.equal(device.kind, 'app_locked');
    assert.equal(device.brand, 'xm');
  });

  it('keeps a VIP camera with port 554 as a camera, not four Wi-Fi dots', () => {
    const device = classifyDevice({
      ip: '192.168.0.21',
      ports: [554, 80],
      httpHint: 'Intelbras VIP 1130',
    });
    assert.equal(device.kind, 'camera');
    assert.equal(device.brand, 'intelbras');
  });

  it('skips printers and random HTTP boxes', () => {
    const device = classifyDevice({
      ip: '192.168.0.50',
      ports: [80],
      httpHint: 'HP LaserJet',
    });
    assert.equal(device.kind, 'unknown');
  });

  it('expands a /24 without including the scanner itself', () => {
    const hosts = subnetHosts('192.168.0.10');
    assert.equal(hosts.length, 253);
    assert.equal(hosts.includes('192.168.0.10'), false);
    assert.equal(hosts[0], '192.168.0.1');
  });
});
