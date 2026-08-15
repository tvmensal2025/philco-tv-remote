import { existsSync } from 'node:fs';
import path from 'node:path';

export function fxCatalogPath() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const file = path.join(dir, 'assets', 'fx', 'catalog.json');
    if (existsSync(file)) return file;
    dir = path.dirname(dir);
  }
  return path.join(process.cwd(), '../../assets/fx/catalog.json');
}
