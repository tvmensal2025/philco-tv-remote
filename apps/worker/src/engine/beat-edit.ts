import {
  alignAnalysisToHook,
  energyAt,
  sectionAt,
  snapTimeToGrid,
  type MusicAnalysis,
} from '@reelops/shared';
import { joinSpec, joinedDuration } from '../pipeline/finish.js';
import type { ReelPlan, ReelPlanScene } from './planner.js';

export type BeatEditResult = {
  plan: ReelPlan;
  analysis: MusicAnalysis;
  musicStartSeconds: number;
  snappedCuts: number;
};

function editPoints(scenes: ReelPlanScene[]) {
  const starts: number[] = [0];
  let elapsed = scenes[0]?.duration ?? 0;
  for (let index = 1; index < scenes.length; index += 1) {
    const overlap = joinSpec(scenes[index]!.transition, scenes[index]!.joinDuration).duration;
    starts.push(Math.max(0, elapsed - overlap));
    elapsed = elapsed + scenes[index]!.duration - overlap;
  }
  return { starts, duration: Number(elapsed.toFixed(3)) };
}

function durationsFromStarts(scenes: ReelPlanScene[], starts: number[], total: number) {
  return scenes.map((scene, index) => {
    const overlap =
      index + 1 < scenes.length
        ? joinSpec(scenes[index + 1]!.transition, scenes[index + 1]!.joinDuration).duration
        : 0;
    const start = starts[index] ?? 0;
    const next = starts[index + 1] ?? total;
    const duration = index + 1 < scenes.length ? next + overlap - start : total - start;
    return Number(Math.min(12, Math.max(0.8, duration)).toFixed(3));
  });
}

function clampToWindow(
  scene: ReelPlanScene,
  duration: number,
  windowByCamera: Map<string, { start: number; duration: number }>,
) {
  const window = windowByCamera.get(scene.camera_id);
  if (!window) return duration;
  const max = Math.max(0.8, window.start + window.duration - scene.source_start_offset);
  return Number(Math.min(max, duration).toFixed(3));
}

function musicalJoin(input: {
  scene: ReelPlanScene;
  timeSeconds: number;
  analysis: MusicAnalysis;
  sfxDensity: number;
  snapStrength: number;
}): Pick<ReelPlanScene, 'transition' | 'joinDuration' | 'joinOverlay'> {
  const section = sectionAt(input.analysis, input.timeSeconds);
  const energy = energyAt(input.analysis, input.timeSeconds);
  const beat = input.analysis.beats.find(
    (row) => Math.abs(row.timeSeconds - input.timeSeconds) < 0.08,
  );
  const onDownbeat = Boolean(beat?.isDownbeat);
  let transition = input.scene.transition;
  let joinDuration = input.scene.joinDuration;
  let joinOverlay = input.scene.joinOverlay;

  if (input.snapStrength >= 0.62 && onDownbeat && (section?.kind === 'drop' || energy > 0.72)) {
    if (transition === 'dissolve') {
      transition = 'cut';
      joinDuration = 0.04;
    }
  }
  if (section?.kind === 'break' && transition === 'cut' && input.snapStrength < 0.55) {
    transition = 'dissolve';
    joinDuration = 0.5;
  }
  return { transition, joinDuration, joinOverlay };
}

export function applyBeatEditing(input: {
  plan: ReelPlan;
  analysis: MusicAnalysis;
  snapStrength: number;
  sfxDensity: number;
  windowByCamera: Map<string, { start: number; duration: number }>;
  targetDuration: number;
}): BeatEditResult {
  const aligned = alignAnalysisToHook(input.analysis);
  if (aligned.confidence < 0.18 || aligned.beats.length < 6 || input.plan.scenes.length < 2) {
    return {
      plan: input.plan,
      analysis: aligned,
      musicStartSeconds: aligned.offsetSeconds,
      snappedCuts: 0,
    };
  }

  const original = editPoints(input.plan.scenes);
  const snappedStarts = original.starts.map((time, index) => {
    if (index === 0) return 0;
    const overlap = joinSpec(
      input.plan.scenes[index]!.transition,
      input.plan.scenes[index]!.joinDuration,
    ).duration;
    const hit = overlap >= 0.35 ? time + overlap / 2 : time;
    const preferDownbeat =
      index === 1 || index === original.starts.length - 1 || input.snapStrength >= 0.5;
    const snapped = snapTimeToGrid(hit, aligned, {
      snapStrength: input.snapStrength,
      preferDownbeat,
    });
    return overlap >= 0.35 ? Math.max(0, snapped - overlap / 2) : snapped;
  });

  for (let i = 1; i < snappedStarts.length; i += 1) {
    const previous = snappedStarts[i - 1] ?? 0;
    if ((snappedStarts[i] ?? 0) < previous + 0.75) snappedStarts[i] = previous + 0.75;
  }

  let end = snapTimeToGrid(original.duration, aligned, {
    snapStrength: input.snapStrength,
    preferDownbeat: input.snapStrength >= 0.45,
  });
  const lastStart = snappedStarts.at(-1) ?? 0;
  end = Math.max(lastStart + 0.8, end);
  const target = input.targetDuration;
  if (end > target + 1.6) end = target + 1.6;
  if (end < target - 2) end = Math.max(lastStart + 0.8, target - 2);

  const durations = durationsFromStarts(input.plan.scenes, snappedStarts, end);
  let snappedCuts = 0;
  const scenes = input.plan.scenes.map((scene, index) => {
    const nextDuration = clampToWindow(
      scene,
      durations[index] ?? scene.duration,
      input.windowByCamera,
    );
    if (Math.abs(nextDuration - scene.duration) >= 0.04) snappedCuts += 1;
    const time = snappedStarts[index] ?? 0;
    const musical =
      index === 0
        ? {}
        : musicalJoin({
            scene,
            timeSeconds: time,
            analysis: aligned,
            sfxDensity: input.sfxDensity,
            snapStrength: input.snapStrength,
          });
    return { ...scene, duration: nextDuration, ...musical };
  });

  const duration = joinedDuration(
    scenes.map((scene) => ({
      duration: scene.duration,
      transition: scene.transition,
      joinDuration: scene.joinDuration,
    })),
  );
  const audio = input.plan.audio ? { ...input.plan.audio, duration } : undefined;
  return {
    plan: {
      ...input.plan,
      scenes,
      duration,
      audio,
      music: {
        startSeconds: aligned.offsetSeconds,
        bpm: aligned.bpm,
        confidence: aligned.confidence,
      },
    },
    analysis: aligned,
    musicStartSeconds: aligned.offsetSeconds,
    snappedCuts,
  };
}
