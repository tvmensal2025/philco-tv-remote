import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLicensedMusic, type LicensedMusicAsset } from './audio.js';

const TRACKS = [
  { file: 'musica1.mp3', assetId: 'musica1' },
  { file: 'musica2.mp3', assetId: 'musica2' },
] as const;

function repoRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'assets', 'music', 'musica1.mp3'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
}

export function licensedMusicBeds(): LicensedMusicAsset[] {
  const folder = path.join(repoRoot(), 'assets', 'music');
  return TRACKS.flatMap((track) => {
    const source = path.join(folder, track.file);
    if (!existsSync(source)) return [];
    const asset: LicensedMusicAsset = {
      source,
      licenseType: 'owned',
      licenseReference: `sofia-veo-owned-${track.assetId}`,
      provider: 'owner',
      assetId: track.assetId,
      allowedUsage: ['background', 'reel'],
    };
    try {
      assertLicensedMusic(asset);
      return [asset];
    } catch {
      return [];
    }
  });
}

export function pickMusicBed(seed = 'casa'): LicensedMusicAsset | null {
  const beds = licensedMusicBeds();
  if (!beds.length) return null;
  const total = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return beds[total % beds.length] ?? beds[0]!;
}
