export type EditingIntensityProfile = {
  targetShotDurationMs: number;
  maxCameraSwitchesPer10s: number;
  transitionProbability: number;
  zoomProbability: number;
  maxZoomStrength: number;
  motionStrength: number;
  textDensity: number;
  beatSnapStrength: number;
  sfxDensity: number;
};

const anchors: Array<{ value: number; profile: EditingIntensityProfile }> = [
  {
    value: 0.1,
    profile: {
      targetShotDurationMs: 4800,
      maxCameraSwitchesPer10s: 1,
      transitionProbability: 0.12,
      zoomProbability: 0.08,
      maxZoomStrength: 1.04,
      motionStrength: 0.12,
      textDensity: 0.15,
      beatSnapStrength: 0.05,
      sfxDensity: 0.04,
    },
  },
  {
    value: 0.25,
    profile: {
      targetShotDurationMs: 3800,
      maxCameraSwitchesPer10s: 2,
      transitionProbability: 0.2,
      zoomProbability: 0.14,
      maxZoomStrength: 1.06,
      motionStrength: 0.22,
      textDensity: 0.22,
      beatSnapStrength: 0.12,
      sfxDensity: 0.08,
    },
  },
  {
    value: 0.4,
    profile: {
      targetShotDurationMs: 3000,
      maxCameraSwitchesPer10s: 3,
      transitionProbability: 0.32,
      zoomProbability: 0.22,
      maxZoomStrength: 1.08,
      motionStrength: 0.38,
      textDensity: 0.32,
      beatSnapStrength: 0.28,
      sfxDensity: 0.16,
    },
  },
  {
    value: 0.6,
    profile: {
      targetShotDurationMs: 2200,
      maxCameraSwitchesPer10s: 4,
      transitionProbability: 0.48,
      zoomProbability: 0.38,
      maxZoomStrength: 1.12,
      motionStrength: 0.58,
      textDensity: 0.48,
      beatSnapStrength: 0.52,
      sfxDensity: 0.32,
    },
  },
  {
    value: 0.8,
    profile: {
      targetShotDurationMs: 1600,
      maxCameraSwitchesPer10s: 6,
      transitionProbability: 0.62,
      zoomProbability: 0.55,
      maxZoomStrength: 1.16,
      motionStrength: 0.78,
      textDensity: 0.62,
      beatSnapStrength: 0.72,
      sfxDensity: 0.5,
    },
  },
  {
    value: 1,
    profile: {
      targetShotDurationMs: 1200,
      maxCameraSwitchesPer10s: 8,
      transitionProbability: 0.78,
      zoomProbability: 0.7,
      maxZoomStrength: 1.18,
      motionStrength: 0.92,
      textDensity: 0.78,
      beatSnapStrength: 0.88,
      sfxDensity: 0.7,
    },
  },
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function clampEditingIntensity(value: number) {
  if (!Number.isFinite(value)) return 0.4;
  return Math.min(1, Math.max(0, value));
}

export function defaultEditingIntensityForProgram(program: string) {
  if (program === 'casa') return 0.25;
  if (program === 'assinatura') return 0.35;
  if (program === 'oficio') return 0.45;
  if (program === 'pulso') return 0.8;
  return 0.4;
}

export function resolveEditingIntensityProfile(value: number): EditingIntensityProfile {
  const intensity = clampEditingIntensity(value);
  const nextIndex = anchors.findIndex((anchor) => intensity <= anchor.value);
  const high = anchors[nextIndex < 0 ? anchors.length - 1 : nextIndex]!;
  const low = anchors[Math.max(0, (nextIndex < 0 ? anchors.length - 1 : nextIndex) - 1)]!;
  if (high.value === low.value) return { ...high.profile };
  const t = (intensity - low.value) / (high.value - low.value);
  return {
    targetShotDurationMs: Math.round(
      lerp(low.profile.targetShotDurationMs, high.profile.targetShotDurationMs, t),
    ),
    maxCameraSwitchesPer10s: Number(
      lerp(low.profile.maxCameraSwitchesPer10s, high.profile.maxCameraSwitchesPer10s, t).toFixed(2),
    ),
    transitionProbability: Number(
      lerp(low.profile.transitionProbability, high.profile.transitionProbability, t).toFixed(3),
    ),
    zoomProbability: Number(
      lerp(low.profile.zoomProbability, high.profile.zoomProbability, t).toFixed(3),
    ),
    maxZoomStrength: Number(
      lerp(low.profile.maxZoomStrength, high.profile.maxZoomStrength, t).toFixed(3),
    ),
    motionStrength: Number(
      lerp(low.profile.motionStrength, high.profile.motionStrength, t).toFixed(3),
    ),
    textDensity: Number(lerp(low.profile.textDensity, high.profile.textDensity, t).toFixed(3)),
    beatSnapStrength: Number(
      lerp(low.profile.beatSnapStrength, high.profile.beatSnapStrength, t).toFixed(3),
    ),
    sfxDensity: Number(lerp(low.profile.sfxDensity, high.profile.sfxDensity, t).toFixed(3)),
  };
}
