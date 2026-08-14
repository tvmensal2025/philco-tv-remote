import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const config = {
  apiUrl: 'http://localhost:3000',
  ingestKey: env.INGEST_API_KEY,
  restaurantId: context.restaurant.id,
  outbox: 'C:\\\\CenaPronta\\\\outbox',
  uploaded: 'C:\\\\CenaPronta\\\\uploaded',
  failed: 'C:\\\\CenaPronta\\\\failed',
  stableMs: 1000,
  cameras: { 'cam-01': 1, 'cam-02': 2, 'cam-03': 3, 'cam-04': 4 },
};
writeFileSync('apps/uploader/config.json', JSON.stringify(config, null, 2));
mkdirSync('C:/CenaPronta/outbox', { recursive: true });
mkdirSync('C:/CenaPronta/uploaded', { recursive: true });
mkdirSync('C:/CenaPronta/failed', { recursive: true });
const names = {
  'cam-01.mp4': 'cam-01_20260813T134200_20260813T134245.mp4',
  'cam-02.mp4': 'cam-02_20260813T134200_20260813T134241.mp4',
  'cam-03.mp4': 'cam-03_20260813T134200_20260813T134245.mp4',
  'cam-04.mp4': 'cam-04_20260813T134200_20260813T134245.mp4',
};
for (const [src, dest] of Object.entries(names)) {
  copyFileSync(join('test-assets/e2e', src), join('C:/CenaPronta/outbox', dest));
}
console.log(JSON.stringify({ restaurantId: context.restaurant.id, files: Object.values(names) }));
