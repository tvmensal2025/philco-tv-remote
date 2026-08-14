export type StyleName = 'natural' | 'dynamic' | 'cinematic';

export function styleRhythm(style: StyleName) {
  if (style === 'dynamic') return { min: 1.2, max: 2.5, target: 1.8 };
  if (style === 'cinematic') return { min: 4, max: 8, target: 6 };
  return { min: 2.5, max: 4, target: 3.2 };
}

export function clampSceneDuration(duration: number, style: StyleName) {
  const rhythm = styleRhythm(style);
  return Math.min(rhythm.max, Math.max(rhythm.min, duration));
}

export function fillToDuration<T extends { durationSeconds: number }>(
  scenes: T[],
  targetDuration: number,
  style: StyleName,
): T[] {
  if (!scenes.length || targetDuration <= 0) return [];
  const seed = scenes.map((scene) => ({
    ...scene,
    durationSeconds: clampSceneDuration(scene.durationSeconds, style),
  }));
  const filled: T[] = [];
  let used = 0;
  let index = 0;
  while (used < targetDuration - 0.05 && filled.length < 12) {
    const next = { ...seed[index % seed.length] };
    next.durationSeconds = Number(Math.min(next.durationSeconds, targetDuration - used).toFixed(3));
    if (next.durationSeconds < 0.8) break;
    filled.push(next);
    used += next.durationSeconds;
    index += 1;
  }
  return filled;
}
