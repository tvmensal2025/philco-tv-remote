export const reelDurationPresets = [15, 30, 45, 60] as const;
export type ReelDurationPreset = (typeof reelDurationPresets)[number];

export const reelDurationChoiceSchemaValues = ['ai', 15, 30, 45, 60] as const;

export function isReelDurationPreset(value: unknown): value is ReelDurationPreset {
  return reelDurationPresets.includes(value as ReelDurationPreset);
}

export function snapReelDuration(seconds: number): ReelDurationPreset {
  const n = Math.max(8, Math.min(90, Number(seconds) || 30));
  return reelDurationPresets.reduce((best, preset) =>
    Math.abs(preset - n) < Math.abs(best - n) ? preset : best,
  );
}

export function searchPoolForDuration(durationSeconds: number) {
  const duration = Math.min(90, Math.max(8, durationSeconds));
  const pad = Math.max(6, Math.round(duration * 0.15));
  return {
    beforeSeconds: Math.min(120, Math.ceil(duration * 0.6) + pad),
    afterSeconds: Math.min(120, Math.ceil(duration * 0.4) + pad),
  };
}

export function resolveMomentSearchWindow(input: {
  durationSeconds: number;
  beforeSeconds?: number;
  afterSeconds?: number;
}) {
  const pool = searchPoolForDuration(input.durationSeconds);
  let before = input.beforeSeconds ?? pool.beforeSeconds;
  let after = input.afterSeconds ?? pool.afterSeconds;
  const span = before + after;
  if (span < input.durationSeconds) {
    const need = input.durationSeconds - span;
    before += Math.ceil(need * 0.6);
    after += Math.ceil(need * 0.4);
  }
  return {
    beforeSeconds: Math.max(3, Math.min(120, Math.round(before))),
    afterSeconds: Math.max(3, Math.min(120, Math.round(after))),
  };
}

export function takeCountForDuration(program: string, durationSeconds: number) {
  const pulso = program === 'pulso';
  if (durationSeconds <= 18) return pulso ? 5 : 4;
  if (durationSeconds <= 35) return pulso ? 7 : 6;
  if (durationSeconds <= 50) return pulso ? 8 : 7;
  return pulso ? 10 : 8;
}

export function pickAiReelDuration(input: {
  poolSeconds: number;
  peakCount: number;
  visionScore?: number;
}): ReelDurationPreset {
  const usable = Math.max(8, input.poolSeconds);
  const available = reelDurationPresets.filter((preset) => preset <= usable + 2);
  const options = available.length ? available : ([15] as ReelDurationPreset[]);
  const pick = (want: ReelDurationPreset) =>
    options.includes(want) ? want : options[options.length - 1]!;
  const score = input.visionScore ?? 55;
  if (input.peakCount <= 2 || score < 40) return pick(15);
  if (input.peakCount >= 6 && usable >= 55 && score >= 60) return pick(60);
  if (input.peakCount >= 4 && usable >= 40) return pick(45);
  return pick(30);
}
