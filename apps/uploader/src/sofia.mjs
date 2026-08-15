import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { discoverLan } from './discover.mjs';
import { probeRtsp } from './probe.mjs';

function channelPath(brand, channel) {
  if (brand === 'hikvision') return `/Streaming/Channels/${channel}01`;
  if (brand === 'dahua') return `/cam/realmonitor?channel=${channel}&subtype=0`;
  return `/cam/realmonitor?channel=${channel}&subtype=0`;
}

export function channelRtspUrl({ ip, username, password, brand, channel, port = 554 }) {
  const user = encodeURIComponent(username || 'admin');
  const secret = encodeURIComponent(password ?? '');
  const host = String(ip || '').trim();
  return `rtsp://${user}:${secret}@${host}:${port}${channelPath(brand || 'intelbras', channel)}`;
}

function ensureCameraFolders(root, count = 4) {
  mkdirSync(root, { recursive: true });
  for (let position = 1; position <= count; position += 1) {
    mkdirSync(path.join(root, `C${position}`), { recursive: true });
  }
}

export function createSofiaAgent({
  apiUrl,
  ingestKey,
  restaurantId,
  getCamerasRoot,
  setCamerasRoot,
  log,
}) {
  let busy = '';
  const authorization = { authorization: `Bearer ${ingestKey}` };

  async function post(body) {
    const response = await fetch(`${apiUrl}/api/ingest/sofia`, {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ restaurantId, ...body }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `sofia ${response.status}`);
    }
    return response.json();
  }

  async function tick() {
    if (busy) return;
    const response = await fetch(`${apiUrl}/api/ingest/sofia?restaurantId=${restaurantId}`, {
      headers: authorization,
    });
    if (!response.ok) return;
    const job = await response.json();
    const command = String(job.command ?? 'idle');
    if (command === 'idle') return;

    if (command === 'scan') {
      busy = 'scan';
      try {
        log?.({ event: 'sofia_scan' });
        const discoveries = await discoverLan();
        await post({ event: 'discoveries', discoveries });
        log?.({ event: 'sofia_found', count: discoveries.length });
      } catch (error) {
        await post({
          event: 'discoveries',
          discoveries: [],
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        busy = '';
      }
      return;
    }

    if (command === 'watch_folder') {
      busy = 'watch_folder';
      try {
        const folderPath =
          (typeof job.selection?.folderPath === 'string' && job.selection.folderPath.trim()) ||
          getCamerasRoot() ||
          'C:\\CenaPronta\\cameras';
        setCamerasRoot(folderPath);
        ensureCameraFolders(folderPath);
        await post({ event: 'folder_ready', folderPath });
        log?.({ event: 'sofia_folder', path: folderPath });
      } catch (error) {
        await post({
          event: 'failed',
          error: error instanceof Error ? error.message : 'Não deu para criar a pasta do gravador.',
        });
      } finally {
        busy = '';
      }
      return;
    }

    if (command === 'configure') {
      busy = 'configure';
      try {
        const selection = job.selection ?? {};
        const channels = Array.isArray(selection.channels) ? selection.channels : [1, 2, 3, 4];
        const results = [];
        for (const position of channels) {
          const url = channelRtspUrl({
            ip: selection.ip,
            username: selection.username,
            password: selection.password,
            brand: selection.brand,
            channel: Number(position),
          });
          const probed = await probeRtsp(url);
          results.push({ position: Number(position), live: Boolean(probed.live) });
        }
        await post({ event: 'configured', channels: results });
        log?.({
          event: 'sofia_configured',
          live: results.filter((item) => item.live).length,
        });
      } catch (error) {
        await post({
          event: 'failed',
          error: error instanceof Error ? error.message : 'Senha ou canal recusado pelo gravador.',
        });
      } finally {
        busy = '';
      }
    }
  }

  return { tick };
}
