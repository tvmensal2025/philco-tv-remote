import {
  cameraBlurb,
  detectBrandMismatch,
  evaluateSceneCoherence,
  sceneLooksMixed,
  scoreCameraCandidate,
  type CameraSceneSignal,
  type SceneCoherenceResult,
} from '@reelops/shared';
import type { RankedCamera } from '@reelops/shared';
import type { ClipCandidate, EditDecision } from '../adapters/analyzer.js';

export function buildCameraSignals(input: {
  clips: ClipCandidate[];
  analysis?: EditDecision | null;
  yolo?: RankedCamera[];
}): CameraSceneSignal[] {
  const rankings = input.analysis?.cameraRankings ?? [];
  const scenes = input.analysis?.scenes ?? [];
  return input.clips.map((clip) => {
    const rank = rankings.find((row) => row.cameraPosition === clip.position);
    const scene = scenes.find((row) => row.position === clip.position);
    const yolo = input.yolo?.find((row) => row.cameraPosition === clip.position);
    const specific =
      rank?.reason || scene?.reason || cameraBlurb(input.analysis?.reason ?? '', clip.position);
    const summary = specific.trim();
    const mixed = sceneLooksMixed(input.analysis?.reason ?? '');
    const brand = detectBrandMismatch(summary);
    const yoloFood = yolo?.foodVisibility ?? 0;
    const semanticFood = /p[aã]o|bread|prato|comida|food|tandoor|wok|forno|massa|dough/i.test(
      summary,
    )
      ? 0.75
      : 0.2;
    let lighting = yolo?.lighting ?? 0.55;
    if (/escuro|escura|dark|sombra|underexposed|low.?light|quase preto/i.test(summary)) {
      lighting = Math.min(lighting, 0.18);
    }
    return {
      cameraId: clip.cameraId,
      cameraPosition: clip.position,
      cameraRole: clip.role ?? 'master',
      summary,
      lighting,
      foodVisibility: Math.max(yoloFood, semanticFood),
      personVisibility: yolo?.personVisibility ?? 0.4,
      actionRelevance: yolo?.actionCompleteness ?? 0.45,
      cropFeasibility: yolo?.cropFeasibility ?? 0.5,
      blur: yolo?.blur,
      occlusion: yolo?.occlusion,
      visionScore: rank?.score ?? yolo?.visionScore ?? null,
      watermark: brand || yolo?.watermark,
      externalBrand: brand || yolo?.brandMismatch,
      mixedLocations: mixed,
    };
  });
}

export function selectEditorialCameras(
  signals: CameraSceneSignal[],
): SceneCoherenceResult & { scores: ReturnType<typeof scoreCameraCandidate>[] } {
  const coherence = evaluateSceneCoherence(signals);
  const vsPrimary = new Map<string, number>();
  for (const row of coherence.pairwise) {
    if (row.a === coherence.primaryCameraId) vsPrimary.set(row.b, row.score);
    if (row.b === coherence.primaryCameraId) vsPrimary.set(row.a, row.score);
  }
  const scores = signals
    .map((signal) =>
      scoreCameraCandidate(
        signal,
        signal.cameraId === coherence.primaryCameraId ? 100 : (vsPrimary.get(signal.cameraId) ?? 0),
      ),
    )
    .sort((a, b) => b.score - a.score);
  return { ...coherence, scores };
}

export function filterClipsForEdit(
  clips: ClipCandidate[],
  editorial: SceneCoherenceResult,
): ClipCandidate[] {
  const allowed = new Set(editorial.compatibleCameraIds);
  const filtered = clips.filter((clip) => allowed.has(clip.cameraId));
  if (filtered.length) return filtered;
  return clips.filter((clip) => clip.cameraId === editorial.primaryCameraId);
}
