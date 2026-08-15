import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const SCAN_PORTS = [554, 80, 8000, 34567];
const KIND_RANK = { dvr: 0, camera: 1, app_locked: 2, unknown: 9 };

export function localIpv4s() {
  const out = [];
  for (const rows of Object.values(os.networkInterfaces())) {
    for (const row of rows ?? []) {
      const family = String(row.family);
      if (family !== 'IPv4' && family !== '4') continue;
      if (row.internal) continue;
      if (row.address.startsWith('169.254.')) continue;
      out.push(row.address);
    }
  }
  return [...new Set(out)];
}

export function subnetHosts(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return [];
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const hosts = [];
  for (let host = 1; host <= 254; host += 1) {
    if (host === parts[3]) continue;
    hosts.push(`${prefix}.${host}`);
  }
  return hosts;
}

export function classifyDevice({ ip, ports = [], httpHint = '', onvif = '' }) {
  const hasRtsp = ports.includes(554);
  const hasXm = ports.includes(34567);
  const hasSdk = ports.includes(8000);
  const blob = `${httpHint} ${onvif}`.toLowerCase();
  let brand = 'generic';
  if (/intelbras|mhdx|vip-\d|intelbras cloud/.test(blob)) brand = 'intelbras';
  else if (/hikvision|hik-connect|ds-\d/.test(blob)) brand = 'hikvision';
  else if (/dahua|xvr|hfw/.test(blob)) brand = 'dahua';
  else if (/xmeye|icsee|yoosee|\bxm\b/.test(blob) || (hasXm && !hasRtsp)) brand = 'xm';

  let kind = 'unknown';
  if (!hasRtsp && hasXm) kind = 'app_locked';
  else if (/mhdx|nvr|dvr|xvr|gravador/.test(blob)) kind = 'dvr';
  else if (hasRtsp && (hasSdk || /networkvideodisplay|nvr/.test(blob))) kind = 'dvr';
  else if (
    hasRtsp &&
    ports.includes(80) &&
    /intelbras|hikvision|dahua/.test(blob) &&
    !/vip|ipc|camera/.test(blob)
  )
    kind = 'dvr';
  else if (hasRtsp || onvif) kind = 'camera';
  else if (hasSdk) kind = 'camera';

  const label =
    kind === 'dvr'
      ? brand === 'intelbras'
        ? 'Intelbras MHDX'
        : brand === 'hikvision'
          ? 'Hikvision NVR'
          : brand === 'dahua'
            ? 'Dahua gravador'
            : 'Gravador'
      : kind === 'app_locked'
        ? 'Câmera só no app (iCSee/XMEye)'
        : brand === 'intelbras'
          ? 'Intelbras VIP'
          : 'Câmera IP';

  return {
    id: ip,
    ip,
    ports,
    kind,
    brand,
    name: `${label} em ${ip}`,
  };
}

function probePort(ip, port, timeoutMs = 350) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()),
  );
  return out;
}

async function httpHint(ip, port) {
  try {
    const response = await fetch(`http://${ip}:${port}/`, {
      signal: AbortSignal.timeout(900),
      redirect: 'follow',
      headers: { 'user-agent': 'CenaPronta-Sofia' },
    });
    const server = response.headers.get('server') || '';
    const realm = response.headers.get('www-authenticate') || '';
    const body = (await response.text()).slice(0, 4000);
    const title = body.match(/<title>([^<]+)<\/title>/i)?.[1] ?? '';
    return `${server} ${realm} ${title} ${body}`.replace(/\s+/g, ' ').slice(0, 800);
  } catch {
    return '';
  }
}

function probeXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
  xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:${randomUUID()}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`;
}

export function onvifProbe(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const found = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const finish = () => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on('message', (msg, rinfo) => {
      found.set(rinfo.address, { ip: rinfo.address, onvif: msg.toString().slice(0, 1500) });
    });
    socket.on('error', () => {
      clearTimeout(timer);
      finish();
    });
    socket.bind(0, () => {
      const payload = Buffer.from(probeXml());
      try {
        socket.setBroadcast(true);
      } catch {
        /* Windows without broadcast is still ok */
      }
      socket.send(payload, 3702, '239.255.255.250');
    });
  });
}

export async function discoverLan() {
  const locals = localIpv4s();
  const hosts = [...new Set(locals.flatMap(subnetHosts))];
  const onvifPromise = onvifProbe();
  const open = [];
  await mapLimit(hosts, 64, async (ip) => {
    const ports = [];
    for (const port of SCAN_PORTS) {
      if (await probePort(ip, port)) ports.push(port);
    }
    if (ports.length) open.push({ ip, ports });
  });
  const onvif = await onvifPromise;
  const onvifByIp = new Map(onvif.map((row) => [row.ip, row.onvif]));
  for (const row of onvif) {
    if (!open.some((item) => item.ip === row.ip)) open.push({ ip: row.ip, ports: [] });
  }
  const devices = [];
  for (const host of open) {
    let hint = '';
    if (host.ports.includes(80)) hint = await httpHint(host.ip, 80);
    if (!hint && host.ports.includes(8000)) hint = await httpHint(host.ip, 8000);
    const device = classifyDevice({
      ip: host.ip,
      ports: host.ports,
      httpHint: hint,
      onvif: onvifByIp.get(host.ip) || '',
    });
    if (device.kind === 'unknown') continue;
    devices.push(device);
  }
  return devices.sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9));
}
