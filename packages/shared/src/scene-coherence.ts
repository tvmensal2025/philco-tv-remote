export type EditMode = 'single_camera' | 'dual_camera' | 'multicamera';

export type CameraSceneSignal = {
  cameraId: string;
  cameraPosition: number;
  cameraRole: string;
  summary: string;
  lighting: number;
  foodVisibility: number;
  personVisibility: number;
  actionRelevance: number;
  cropFeasibility: number;
  blur?: number;
  occlusion?: number;
  visionScore?: number | null;
  watermark?: boolean;
  externalBrand?: boolean;
  mixedLocations?: boolean;
};

export type PairwiseCoherence = {
  a: string;
  b: string;
  score: number;
  reason: string;
};

export type RejectedCamera = {
  cameraId: string;
  cameraPosition: number;
  reason: string;
};

export type SceneCoherenceResult = {
  pairwise: PairwiseCoherence[];
  multicameraConfidence: number;
  recommendedMode: EditMode;
  primaryCameraId: string;
  primaryCameraPosition: number;
  compatibleCameraIds: string[];
  rejected: RejectedCamera[];
};

export type CameraCandidateScore = CameraSceneSignal & {
  score: number;
  coherenceWithPrimary: number;
  reasons: string[];
};

const FOREIGN_BRAND =
  /canal\s*madeira|caravela|super\s*bock|marca\s*d['’]?agua|watermark|canal\s*de\s*tv|tv\s*channel/i;

const FOOD_FAMILIES = [
  ['pao', 'pão', 'bread', 'roti', 'naan', 'tandoor', 'massa', 'dough', 'padaria', 'flatbread'],
  ['wok', 'stir', 'refogado', 'stir-fry', 'stirfry', 'frigideira', 'frying'],
  ['marisco', 'polvo', 'octopus', 'peixe', 'seafood', 'peixe'],
  ['fogo', 'lenha', 'wood-fired', 'wood fired', 'forno a lenha'],
];

const OUTDOOR = /fachada|rua|exterior|outdoor|patio|pátio|talking|varanda|calçada/;
const INDOOR = /cozinha|kitchen|forno|tandoor|wok|balcão|padaria|prep/;

export function detectBrandMismatch(text: string) {
  return FOREIGN_BRAND.test(text);
}

export function sceneLooksMixed(text: string) {
  return /nao (sao|e|eh) o mesmo|lugares diferentes|ambientes diferentes|cenas distintas|nao o mesmo local|different (place|kitchen|location|scene)|not the same/i.test(
    normalize(text),
  );
}

export function cameraBlurb(text: string, position: number) {
  const match = text.match(new RegExp(`C${position}\\b[\\s\\S]{0,320}`, 'i'));
  if (!match) return '';
  const cut = match[0].split(new RegExp(`C(?!${position})\\d\\b`, 'i'))[0] ?? match[0];
  return cut.trim();
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string) {
  return new Set(
    normalize(text)
      .split(' ')
      .filter((word) => word.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 0.2;
  let inter = 0;
  for (const word of a) if (b.has(word)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function foodFamily(text: string) {
  const n = normalize(text);
  for (const family of FOOD_FAMILIES) {
    if (family.some((key) => n.includes(normalize(key)))) return family[0]!;
  }
  return null;
}

export function pairwiseCoherence(a: CameraSceneSignal, b: CameraSceneSignal): PairwiseCoherence {
  const textA = `${a.summary} ${a.cameraRole}`;
  const textB = `${b.summary} ${b.cameraRole}`;
  const overlap = jaccard(tokens(textA), tokens(textB));
  const famA = foodFamily(textA);
  const famB = foodFamily(textB);
  const familyMismatch = Boolean(famA && famB && famA !== famB);
  const outdoorA = OUTDOOR.test(normalize(textA));
  const outdoorB = OUTDOOR.test(normalize(textB));
  const indoorA = INDOOR.test(normalize(textA));
  const indoorB = INDOOR.test(normalize(textB));
  const placeMismatch = (outdoorA && indoorB) || (outdoorB && indoorA);
  const lightGap = Math.abs(a.lighting - b.lighting);
  const brand = Boolean(a.watermark || a.externalBrand || b.watermark || b.externalBrand);
  const mixed = Boolean(a.mixedLocations || b.mixedLocations);
  let score = 22 + overlap * 55;
  score += Math.min(a.actionRelevance, b.actionRelevance) * 10;
  if (familyMismatch) score -= 42;
  if (placeMismatch) score -= 34;
  if (brand) score -= 28;
  if (mixed && (!famA || !famB || famA !== famB)) score -= 40;
  score -= lightGap * 18;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const reasons = [];
  if (familyMismatch) reasons.push(`food family ${famA} vs ${famB}`);
  if (placeMismatch) reasons.push('indoor vs outdoor');
  if (mixed && (!famA || famA !== famB)) reasons.push('mixed locations');
  if (lightGap > 0.35) reasons.push('lighting mismatch');
  if (!reasons.length) reasons.push(overlap > 0.25 ? 'related scene' : 'weak overlap');
  return { a: a.cameraId, b: b.cameraId, score, reason: reasons.join('; ') };
}

export function scoreCameraCandidate(camera: CameraSceneSignal, coherenceWithPrimary: number) {
  const darkPenalty = camera.lighting < 0.22 ? 32 : camera.lighting < 0.35 ? 14 : 0;
  const watermarkPenalty = camera.watermark || camera.externalBrand ? 45 : 0;
  const rolePrior =
    camera.cameraRole === 'food'
      ? 4
      : camera.cameraRole === 'master'
        ? 4
        : camera.cameraRole === 'side'
          ? 2
          : 1;
  const reasons: string[] = [];
  if (camera.watermark || camera.externalBrand) reasons.push('external branding / watermark');
  if (camera.lighting < 0.22) reasons.push('underexposed');
  if (coherenceWithPrimary < 42 && coherenceWithPrimary > 0) reasons.push('weak scene coherence');
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        camera.foodVisibility * 20 +
          camera.personVisibility * 16 +
          camera.lighting * 18 +
          (1 - (camera.blur ?? 0.2)) * 10 +
          (1 - (camera.occlusion ?? 0.15)) * 6 +
          camera.cropFeasibility * 8 +
          camera.actionRelevance * 10 +
          (camera.visionScore ?? 50) * 0.08 +
          Math.min(20, coherenceWithPrimary * 0.12) +
          rolePrior -
          darkPenalty -
          watermarkPenalty,
      ),
    ),
  );
  if (score >= 70) reasons.unshift('strong visual');
  return { ...camera, score, coherenceWithPrimary, reasons };
}

export function evaluateSceneCoherence(cameras: CameraSceneSignal[]): SceneCoherenceResult {
  if (!cameras.length) {
    return {
      pairwise: [],
      multicameraConfidence: 0,
      recommendedMode: 'single_camera',
      primaryCameraId: '',
      primaryCameraPosition: 1,
      compatibleCameraIds: [],
      rejected: [],
    };
  }
  const prelim = cameras.map((camera) => scoreCameraCandidate(camera, 100));
  prelim.sort((a, b) => b.score - a.score);
  const primary = prelim[0]!;
  const pairwise = cameras.flatMap((a, index) =>
    cameras.slice(index + 1).map((b) => pairwiseCoherence(a, b)),
  );
  const vsPrimary = new Map<string, PairwiseCoherence>();
  for (const row of pairwise) {
    if (row.a === primary.cameraId) vsPrimary.set(row.b, row);
    if (row.b === primary.cameraId) vsPrimary.set(row.a, row);
  }
  const rejected: RejectedCamera[] = [];
  const compatible: CameraSceneSignal[] = [];
  for (const camera of cameras) {
    if (camera.cameraId === primary.cameraId) {
      compatible.push(camera);
      continue;
    }
    const pair = vsPrimary.get(camera.cameraId);
    const scored = scoreCameraCandidate(camera, pair?.score ?? 0);
    const brandHit =
      camera.watermark || camera.externalBrand || detectBrandMismatch(camera.summary);
    if (brandHit) {
      rejected.push({
        cameraId: camera.cameraId,
        cameraPosition: camera.cameraPosition,
        reason: 'external branding / unrelated channel',
      });
      continue;
    }
    if (camera.lighting < 0.22) {
      rejected.push({
        cameraId: camera.cameraId,
        cameraPosition: camera.cameraPosition,
        reason: 'underexposed / unusable lighting',
      });
      continue;
    }
    if ((pair?.score ?? 0) < 42 || scored.score < 28) {
      rejected.push({
        cameraId: camera.cameraId,
        cameraPosition: camera.cameraPosition,
        reason: pair?.reason || 'different location / unrelated content',
      });
      continue;
    }
    compatible.push(camera);
  }
  const pairScores = cameras
    .filter((camera) => camera.cameraId !== primary.cameraId)
    .map((camera) => vsPrimary.get(camera.cameraId)?.score ?? 0);
  const meanAll = pairScores.length
    ? pairScores.reduce((sum, value) => sum + value, 0) / pairScores.length
    : 0;
  const compatiblePairs = compatible
    .filter((camera) => camera.cameraId !== primary.cameraId)
    .map((camera) => vsPrimary.get(camera.cameraId)?.score ?? 0);
  const multicameraConfidence = Math.round(
    compatible.length < 2
      ? meanAll * 0.6
      : compatiblePairs.reduce((sum, value) => sum + value, 0) /
          Math.max(1, compatiblePairs.length),
  );
  const recommendedMode: EditMode =
    compatible.length >= 3
      ? 'multicamera'
      : compatible.length === 2
        ? 'dual_camera'
        : 'single_camera';
  const compatibleIds = compatible.map((camera) => camera.cameraId);
  return {
    pairwise,
    multicameraConfidence,
    recommendedMode,
    primaryCameraId: primary.cameraId,
    primaryCameraPosition: primary.cameraPosition,
    compatibleCameraIds: compatibleIds,
    rejected,
  };
}

export function groundedCaption(input: {
  caption?: string | null;
  visionReason?: string | null;
  restaurantName?: string | null;
}) {
  const caption = input.caption?.trim() ?? '';
  if (!caption) return null;
  if (
    /brasileiro|italiano|japones|japonês|tailandes|ingrediente|desconto|premio|prêmio/i.test(
      caption,
    )
  ) {
    return null;
  }
  const reason = normalize(input.visionReason ?? '');
  const hits = caption
    .split(/\s+/)
    .filter((word) => word.length > 3 && reason.includes(normalize(word)));
  if (hits.length < 2) return null;
  return caption.slice(0, 180);
}
