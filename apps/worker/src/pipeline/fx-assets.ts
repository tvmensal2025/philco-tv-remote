import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFxCatalog, type FxAsset, type FxCatalog } from '@reelops/shared';

function repoRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'assets', 'fx', 'catalog.json'))) return dir;
    if (existsSync(path.join(dir, 'assets', 'music', 'musica1.mp3'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
}

export function fxCatalogDir() {
  return path.join(repoRoot(), 'assets', 'fx');
}

export function loadFxCatalogFromDisk(): FxCatalog {
  const file = path.join(fxCatalogDir(), 'catalog.json');
  if (!existsSync(file)) return { assets: [] };
  try {
    return parseFxCatalog(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return { assets: [] };
  }
}

export function resolveFxAssetPath(asset: FxAsset) {
  const file = path.join(fxCatalogDir(), asset.file.replaceAll('\\', '/'));
  return existsSync(file) ? file : null;
}
