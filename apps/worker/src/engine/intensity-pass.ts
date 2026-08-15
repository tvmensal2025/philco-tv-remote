import { resolveEditingIntensityProfile, type EditingIntensityProfile } from '@reelops/shared';
import { joinedDuration } from '../pipeline/finish.js';
import type { ReelPlan, ReelPlanScene } from './planner.js';

function switchCount(scenes: ReelPlanScene[]) {
  let count = 0;
  for (let index = 1; index < scenes.length; index += 1) {
    if (scenes[index]?.camera_id !== scenes[index - 1]?.camera_id) count += 1;
  }
  return count;
}

function capCameraSwitches(scenes: ReelPlanScene[], maxPer10s: number, duration: number) {
  const max = Math.max(1, Math.floor((maxPer10s * Math.max(8, duration)) / 10));
  let next = scenes.map((scene) => ({ ...scene }));
  while (switchCount(next) > max && next.length > 4) {
    let drop = -1;
    let shortest = Infinity;
    for (let index = 1; index < next.length - 1; index += 1) {
      if (next[index]?.camera_id === next[index - 1]?.camera_id) continue;
      const durationSeconds = next[index]?.duration ?? 99;
      if (durationSeconds < shortest) {
        shortest = durationSeconds;
        drop = index;
      }
    }
    if (drop < 1) break;
    const removed = next[drop]!;
    next = next
      .map((scene, index) =>
        index === drop - 1
          ? { ...scene, duration: Number((scene.duration + removed.duration * 0.6).toFixed(3)) }
          : scene,
      )
      .filter((_, index) => index !== drop);
  }
  return next;
}

function budgetTransitions(scenes: ReelPlanScene[], probability: number, program: string) {
  if (program === 'casa' || program === 'assinatura') return scenes;
  const styled = scenes
    .map((scene, index) => ({ scene, index }))
    .filter((row) => row.index > 0 && row.scene.transition !== 'cut');
  const keep = Math.max(program === 'pulso' ? 0 : 1, Math.round((scenes.length - 1) * probability));
  if (styled.length <= keep) return scenes;
  const drop = new Set(styled.slice(keep).map((row) => row.index));
  return scenes.map((scene, index) =>
    drop.has(index) ? { ...scene, transition: 'cut', joinDuration: 0.04 } : scene,
  );
}

function styleScene(
  scene: ReelPlanScene,
  index: number,
  count: number,
  profile: EditingIntensityProfile,
): ReelPlanScene {
  let motion = scene.motion;
  let punchIn = scene.punchIn;
  if (profile.motionStrength < 0.2 && !punchIn) motion = 'none';
  if (
    profile.motionStrength >= 0.65 &&
    motion === 'none' &&
    !punchIn &&
    index > 0 &&
    index < count - 1 &&
    (scene.role === 'ambience' || scene.role === 'food')
  ) {
    motion = 'drift';
  }
  if (punchIn && profile.zoomProbability < 0.1) {
    punchIn = false;
    if (motion === 'punch') motion = 'none';
  }
  return { ...scene, motion, punchIn };
}

function ensureFoodPunch(scenes: ReelPlanScene[], zoomProbability: number) {
  if (zoomProbability < 0.45) return scenes;
  if (scenes.some((scene) => scene.punchIn)) return scenes;
  const food = scenes.findIndex(
    (scene, index) => scene.role === 'food' && index > 0 && index < scenes.length - 1,
  );
  if (food < 0) return scenes;
  return scenes.map((scene, index) =>
    index === food
      ? { ...scene, punchIn: true, motion: scene.motion === 'none' ? 'punch' : scene.motion }
      : scene,
  );
}

export function applyEditingIntensity(plan: ReelPlan, profile: EditingIntensityProfile): ReelPlan {
  let scenes = plan.scenes.map((scene, index) =>
    styleScene(scene, index, plan.scenes.length, profile),
  );
  scenes = ensureFoodPunch(scenes, profile.zoomProbability);
  scenes = capCameraSwitches(scenes, profile.maxCameraSwitchesPer10s, plan.duration);
  scenes = budgetTransitions(scenes, profile.transitionProbability, plan.program);
  const duration = joinedDuration(
    scenes.map((scene) => ({
      duration: scene.duration,
      transition: scene.transition,
      joinDuration: scene.joinDuration,
    })),
  );
  return {
    ...plan,
    scenes,
    duration,
    audio: plan.audio ? { ...plan.audio, duration } : undefined,
  };
}

export function intensityForPlan(plan: ReelPlan, value?: number) {
  return resolveEditingIntensityProfile(
    value ?? (plan.program === 'pulso' ? 0.8 : plan.program === 'casa' ? 0.25 : 0.4),
  );
}
