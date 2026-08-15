import { randomUUID } from 'node:crypto';
import { isTenantMediaPath } from '../../packages/shared/dist/paths.js';

const tenants = Array.from({ length: 1000 }, () => randomUUID());
const restaurant = randomUUID();
let leaks = 0;
for (let i = 0; i < tenants.length; i += 1) {
  const path = `cenapronta/raw/${tenants[i]}/${restaurant}/camera-1/2026-08-13/clip.mp4`;
  const other = tenants[(i + 1) % tenants.length];
  if (!isTenantMediaPath(path, tenants[i])) leaks += 1;
  if (isTenantMediaPath(path, other)) leaks += 1;
}
const pass = leaks === 0;
console.log(JSON.stringify({ pass, tenants: tenants.length, leaks }, null, 2));
process.exit(pass ? 0 : 2);
