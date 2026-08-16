import {
  applyFxBudget,
  applyPlaybackSpeedBudget,
  pickAutoFxAsset,
  snapPlaybackSpeed,
  energyAt,
  sectionAt,
  type EditProgram,
  type FxAsset,
  type MusicAnalysis,
} from '@reelops/shared';
import type { PeakHit } from './peak-snap.js';
import type { ReelPlan, ReelPlanScene } from './planner.js';
import { joinTimelineStarts } from '../pipeline/finish.js';

export function assignStrategicFxAndSpeed(input: {
  plan: ReelPlan;
  catalog: FxAsset[];
  peaksByCamera: Map<string, PeakHit[]>;
  outputSeconds: number;
  music?: MusicAnalysis | null;
  sfxDensity?: number;
}): ReelPlan {
  const density = input.sfxDensity ?? 0.35;
  const used = new Set<string>();
  const starts = joinTimelineStarts(input.plan.scenes);
  const withFx = input.plan.scenes.map((scene, index) => {
    if (scene.fxMode === 'none') return { ...scene, fxAssetId: undefined, speed: scene.speed ?? 1 };
    if (scene.fxAssetId && scene.fxAssetId !== 'auto') {
      used.add(scene.fxAssetId);
      return scene;
    }
    const timeline = starts[index] ?? 0;
    const section = input.music ? sectionAt(input.music, timeline) : null;
    const role: 'join' | 'lens' | undefined =
      index === 0
        ? scene.punchIn || scene.role === 'food'
          ? 'lens'
          : undefined
        : density >= 0.16 && section?.kind !== 'break'
          ? 'join'
          : density >= 0.55
            ? 'join'
            : undefined;
    if (index > 0 && density < 0.16) {
      return { ...scene, speed: scene.speed ?? 1, joinOverlay: scene.joinOverlay };
    }
    if (!role || !input.catalog.length) return { ...scene, speed: scene.speed ?? 1 };
    if (index > 0 && section?.kind === 'break' && density < 0.55) {
      return { ...scene, speed: scene.speed ?? 1 };
    }
    if (
      index > 0 &&
      section &&
      section.kind !== 'drop' &&
      section.kind !== 'build' &&
      density < 0.32
    ) {
      return { ...scene, speed: scene.speed ?? 1 };
    }
    const asset = pickAutoFxAsset({
      catalog: input.catalog,
      role,
      program: input.plan.program,
      sceneRole: scene.role,
      punchIn: scene.punchIn,
      usedIds: used,
    });
    if (asset) used.add(asset.id);
    return {
      ...scene,
      fxAssetId: asset?.id,
      speed: scene.speed ?? 1,
      joinOverlay: asset ? undefined : scene.joinOverlay,
    };
  });

  const peakEnergy = (scene: ReelPlanScene, index: number) => {
    const peaks = input.peaksByCamera.get(scene.camera_id) ?? [];
    const start = scene.source_start_offset;
    const end = start + scene.duration;
    const visual = peaks
      .filter((peak) => peak.offsetSeconds >= start && peak.offsetSeconds <= end)
      .reduce((best, peak) => Math.max(best, peak.fusedScore), 0);
    if (!input.music) return visual;
    const timeline = starts[index] ?? 0;
    const musical = energyAt(input.music, timeline + scene.duration * 0.4) * 40;
    const section = sectionAt(input.music, timeline + scene.duration * 0.35);
    const bias =
      section?.kind === 'drop'
        ? 1.45
        : section?.kind === 'build'
          ? 1.12
          : section?.kind === 'break'
            ? 0.28
            : 1;
    return visual * 0.55 + musical * bias;
  };

  let slowIndex = -1;
  let best = 0;
  withFx.forEach((scene, index) => {
    if (scene.duration < 1.2) return;
    if (scene.role === 'food' || scene.punchIn || scene.motion === 'punch') {
      const energy = peakEnergy(scene, index);
      if (energy > best) {
        best = energy;
        slowIndex = index;
      }
    }
  });
  if (slowIndex < 0) {
    withFx.forEach((scene, index) => {
      const energy = peakEnergy(scene, index);
      if (scene.duration >= 1.2 && energy > best) {
        best = energy;
        slowIndex = index;
      }
    });
  }

  const withSpeed = withFx.map((scene, index) => {
    if (scene.speed && scene.speed !== 1)
      return { ...scene, speed: snapPlaybackSpeed(scene.speed) };
    if (index === slowIndex && best >= 20) return { ...scene, speed: 0.5 };
    return { ...scene, speed: 1 };
  });

  const budgeted = applyPlaybackSpeedBudget(
    applyFxBudget(withSpeed, input.catalog, input.outputSeconds, input.plan.program),
    input.outputSeconds,
  );
  return { ...input.plan, scenes: budgeted };
}

export function shouldAssignStrategicFx(
  program: EditProgram,
  scenes: Array<{ fxMode?: 'none' | 'auto' }>,
) {
  return (
    (program === 'oficio' || program === 'assinatura' || program === 'pulso') &&
    scenes.some((scene) => scene.fxMode === 'auto')
  );
}
