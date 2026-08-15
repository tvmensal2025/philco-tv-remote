import { describe, expect, it } from 'vitest';
import {
  applyFxBudget,
  applyPlaybackSpeedBudget,
  parseFxCatalog,
  pickAutoFxAsset,
  snapPlaybackSpeed,
  takeSourceSeconds,
} from './fx-catalog.js';

const smash = {
  id: 'glass-smash-01',
  pack: 'glass-smash',
  file: 'smash/01.webm',
  role: 'join' as const,
  blend: 'alpha' as const,
  durationMs: 700,
  tags: ['smash'],
};
const wipe = {
  id: 'blue-future-wipe-04',
  pack: 'blue-future-v2',
  file: 'BlueFuture/wipe-04.webm',
  role: 'join' as const,
  blend: 'alpha' as const,
  durationMs: 800,
  tags: ['wipe'],
};
const lens = {
  id: 'digital-lens-02',
  pack: 'digital-lens-fx',
  file: 'lens/02.mov',
  role: 'lens' as const,
  blend: 'screen' as const,
  durationMs: 1200,
  tags: ['lens'],
};

describe('fx catalog', () => {
  it('snaps speed onto the allowed ladder', () => {
    expect(snapPlaybackSpeed(0.61)).toBe(0.5);
    expect(snapPlaybackSpeed(1.37)).toBe(1.5);
    expect(takeSourceSeconds(4, 0.5)).toBe(2);
    expect(takeSourceSeconds(4, 2)).toBe(8);
  });

  it('keeps a single strategic slow-mo on a 30s reel', () => {
    const next = applyPlaybackSpeedBudget(
      [
        { duration: 3, speed: 0.5, role: 'food', punchIn: true, preferPeak: true },
        { duration: 3, speed: 0.5, role: 'master' },
        { duration: 3, speed: 1.5, role: 'food', punchIn: true },
      ],
      30,
    );
    expect(next.filter((scene) => scene.speed < 1)).toHaveLength(1);
    expect(next[2]?.speed).toBe(1);
  });

  it('drops smash on Casa and a second smash on a short reel', () => {
    const catalog = parseFxCatalog({ assets: [smash, wipe, lens] }).assets;
    const casa = applyFxBudget([{ fxAssetId: smash.id, role: 'food' }], catalog, 30, 'casa');
    expect(casa[0]?.fxAssetId).toBeUndefined();
    const pulso = applyFxBudget(
      [
        { fxAssetId: smash.id, role: 'food' },
        { fxAssetId: smash.id, role: 'master' },
        { fxAssetId: wipe.id, role: 'side' },
      ],
      catalog,
      30,
      'pulso',
    );
    expect(pulso.filter((scene) => scene.fxAssetId === smash.id)).toHaveLength(1);
  });

  it('keeps a single join pack on Casa', () => {
    const catalog = parseFxCatalog({ assets: [smash, wipe, lens] }).assets;
    const next = applyFxBudget(
      [{ role: 'food' }, { fxAssetId: wipe.id }, { fxAssetId: wipe.id }],
      catalog,
      30,
      'casa',
    );
    expect(next.filter((scene) => scene.fxAssetId === wipe.id)).toHaveLength(1);
  });

  it('picks unused join packs for auto', () => {
    const used = new Set<string>();
    const first = pickAutoFxAsset({
      catalog: [smash, wipe, lens],
      role: 'join',
      program: 'pulso',
      usedIds: used,
    });
    expect(first?.id).toBeTruthy();
    used.add(first!.id);
    const second = pickAutoFxAsset({
      catalog: [smash, wipe, lens],
      role: 'join',
      program: 'pulso',
      usedIds: used,
    });
    expect(second?.id).not.toBe(first?.id);
  });
});
