import { z } from 'zod';

export const fxRoles = ['join', 'lens', 'fullframe', 'film'] as const;
export type FxRole = (typeof fxRoles)[number];

export const fxBlends = ['alpha', 'screen', 'add'] as const;
export type FxBlend = (typeof fxBlends)[number];

export const playbackSpeeds = [0.5, 0.75, 1, 1.5, 2] as const;
export type PlaybackSpeed = (typeof playbackSpeeds)[number];

export const fxAssetSchema = z.object({
  id: z.string().trim().min(1).max(80),
  pack: z.string().trim().min(1).max(80),
  file: z.string().trim().min(1).max(240),
  role: z.enum(fxRoles),
  blend: z.enum(fxBlends).default('alpha'),
  durationMs: z.number().int().min(80).max(4000).default(800),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});
export type FxAsset = z.infer<typeof fxAssetSchema>;

export const fxCatalogSchema = z.object({
  assets: z.array(fxAssetSchema).max(400).default([]),
});
export type FxCatalog = z.infer<typeof fxCatalogSchema>;

export function parseFxCatalog(raw: unknown): FxCatalog {
  const parsed = fxCatalogSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (Array.isArray(raw)) {
    const assets = raw.flatMap((item) => {
      const row = fxAssetSchema.safeParse(item);
      return row.success ? [row.data] : [];
    });
    return { assets };
  }
  return { assets: [] };
}

export function snapPlaybackSpeed(value: unknown): PlaybackSpeed {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 1) return 1;
  return playbackSpeeds.reduce((best, speed) =>
    Math.abs(speed - n) < Math.abs(best - n) ? speed : best,
  );
}

export function takeSourceSeconds(outputSeconds: number, speed: number) {
  const playback = snapPlaybackSpeed(speed);
  return Number(Math.max(0.4, outputSeconds * playback).toFixed(3));
}

export type SpeedBudgetScene = {
  speed?: number;
  role?: string;
  punchIn?: boolean;
  duration: number;
  preferPeak?: boolean;
};

export function applyPlaybackSpeedBudget<T extends SpeedBudgetScene>(
  scenes: T[],
  outputSeconds: number,
): T[] {
  const maxSlow = outputSeconds >= 55 ? 2 : 1;
  let slows = 0;
  return scenes.map((scene) => {
    let speed = snapPlaybackSpeed(scene.speed ?? 1);
    if (speed < 1) {
      if (slows >= maxSlow || scene.duration < 1.2) speed = 1;
      else slows += 1;
    }
    if (speed > 1 && (scene.punchIn || scene.role === 'food')) speed = 1;
    return { ...scene, speed };
  });
}

export type FxBudgetScene = {
  fxAssetId?: string | null;
  fxMode?: 'none' | 'auto';
  role?: string;
  punchIn?: boolean;
  joinOverlay?: string;
};

export function fxBudgetLimits(outputSeconds: number, program?: string) {
  const casa = program === 'casa';
  return {
    join: casa ? 1 : outputSeconds >= 55 ? 3 : 2,
    smash: casa ? 0 : 1,
    lens: 1,
    film: 1,
  };
}

function isSmash(asset: FxAsset) {
  const hay = `${asset.id} ${asset.pack} ${asset.tags.join(' ')}`.toLowerCase();
  return hay.includes('smash') || hay.includes('glass');
}

function isLens(asset: FxAsset) {
  return asset.role === 'lens' || asset.tags.some((tag) => /lens|flare|filter/i.test(tag));
}

function isFilm(asset: FxAsset) {
  return asset.role === 'film' || asset.tags.some((tag) => /film|grain/i.test(tag));
}

export function applyFxBudget<T extends FxBudgetScene>(
  scenes: T[],
  catalog: FxAsset[],
  outputSeconds: number,
  program?: string,
): T[] {
  const byId = new Map(catalog.map((asset) => [asset.id, asset]));
  const limits = fxBudgetLimits(outputSeconds, program);
  let joins = 0;
  let smash = 0;
  let lens = 0;
  let film = 0;
  const casa = program === 'casa';
  return scenes.map((scene, index) => {
    if (scene.fxMode === 'none') return { ...scene, fxAssetId: undefined };
    const locked = scene.fxAssetId ? byId.get(scene.fxAssetId) : undefined;
    if (!locked) {
      if (scene.fxAssetId && scene.fxAssetId !== 'auto') return { ...scene, fxAssetId: undefined };
      return scene;
    }
    if (casa && isSmash(locked)) return { ...scene, fxAssetId: undefined };
    if (isSmash(locked)) {
      if (smash >= limits.smash || index === 0) return { ...scene, fxAssetId: undefined };
      smash += 1;
      return scene;
    }
    if (isLens(locked)) {
      if (lens >= limits.lens) return { ...scene, fxAssetId: undefined };
      lens += 1;
      return scene;
    }
    if (isFilm(locked)) {
      if (film >= limits.film) return { ...scene, fxAssetId: undefined };
      film += 1;
      return scene;
    }
    if (locked.role === 'join' || locked.role === 'fullframe') {
      if (joins >= limits.join || index === 0) return { ...scene, fxAssetId: undefined };
      joins += 1;
    }
    return scene;
  });
}

export function pickAutoFxAsset(input: {
  catalog: FxAsset[];
  role: FxRole;
  program?: string;
  sceneRole?: string;
  punchIn?: boolean;
  usedIds: Set<string>;
}): FxAsset | undefined {
  const casa = input.program === 'casa';
  const pool = input.catalog.filter((asset) => {
    if (input.usedIds.has(asset.id)) return false;
    if (casa && isSmash(asset)) return false;
    if (input.role === 'lens') return isLens(asset) || asset.role === 'lens';
    if (input.role === 'join') return asset.role === 'join' || asset.role === 'fullframe';
    return asset.role === input.role;
  });
  if (input.punchIn && input.role === 'lens') {
    return pool.find((asset) => isLens(asset)) ?? pool[0];
  }
  if (input.sceneRole === 'food' && input.role === 'join') {
    return pool.find((asset) => isSmash(asset)) ?? pool[0];
  }
  return pool[0];
}
