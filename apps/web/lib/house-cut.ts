export type HouseCutTake = {
  id: string;
  reason: string;
  transition: string;
  cropMode?: string | null;
  camera: string;
  duration: number;
};

export type ReelCutMetadata = {
  program?: string;
  analysis?: string;
  recommended_use?: string;
  confidence?: number;
  house_cut?: HouseCutTake[] | null;
  video_project?: unknown;
};

const recommendedUseLabel: Record<string, string> = {
  reel: 'Vale publicar no Instagram.',
  story: 'Fica melhor nos stories.',
  stories: 'Fica melhor nos stories.',
  discard: 'Melhor não publicar este corte.',
  skip: 'Melhor não publicar este corte.',
};

export function humanRecommendedUse(value?: string | null) {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  return recommendedUseLabel[key] ?? null;
}

export function humanConfidence(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const pct = value <= 1 ? Math.round(value * 100) : Math.round(value);
  if (pct < 0 || pct > 100) return null;
  if (pct >= 80) return 'A casa ficou clara neste corte.';
  if (pct >= 55) return 'O corte está bom, com um pouco de dúvida.';
  return 'O corte saiu, mas a imagem não estava tão clara.';
}

export function humanAnalysis(meta?: ReelCutMetadata | null) {
  const analysis = typeof meta?.analysis === 'string' ? meta.analysis.trim() : '';
  return {
    analysis: analysis && !/openai|gemini|gpt-|provider/i.test(analysis) ? analysis : '',
    use: humanRecommendedUse(meta?.recommended_use),
    confidence: humanConfidence(meta?.confidence),
  };
}

export function houseCutTakes(meta?: ReelCutMetadata | null): HouseCutTake[] {
  if (!Array.isArray(meta?.house_cut)) return [];
  return meta.house_cut.filter(
    (take): take is HouseCutTake =>
      Boolean(take) &&
      typeof take === 'object' &&
      typeof take.id === 'string' &&
      typeof take.reason === 'string',
  );
}

export function isDissolveTransition(value?: string | null) {
  return /dissolve|fade|xfade/i.test(String(value ?? ''));
}
