/** Central editorial gates. Tune here — not inside prompts or TESTE5 special cases. */
export const EDITORIAL_RELEASE = 'editorial-p1.1';

export const EDITORIAL = {
  minVisualQuality: 35,
  minContentRelevance: 55,
  prettyButWrongRelevance: 30,
  maxTakeReplacements: 2,
  minHookScore: 55,
  takeSampleFractions: [0.18, 0.5, 0.82] as const,
  reelSampleFractions: [0.04, 0.5, 0.94] as const,
  maxRepairPasses: 1,
  maxScoutHubs: 4,
} as const;

export const hardRejectCodes = [
  'none',
  'black',
  'wrong_scene',
  'no_subject',
  'watermark',
  'unusable',
] as const;
export type HardRejectCode = (typeof hardRejectCodes)[number];
