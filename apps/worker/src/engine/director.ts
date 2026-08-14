import type { EditProgram, RestaurantVideoBrandProfile } from '@reelops/shared';
import {
  mapLegacyMotion,
  mapLegacyTransition,
  parseVideoEditDecision,
  repairVideoEditDecision,
  type VideoEditDecisionV1,
} from '@reelops/shared';
import type { ReelPlan } from './planner.js';

const sceneRoles = ['hook', 'body', 'insert', 'payoff', 'ending'] as const;

export function decisionFromReelPlan(
  plan: ReelPlan,
  ids: { tenantId: string; restaurantId: string; momentId: string; reelId: string },
  brand?: RestaurantVideoBrandProfile,
): VideoEditDecisionV1 {
  const scenes = plan.scenes.map((scene, index) => {
    const startMs = Math.round(scene.source_start_offset * 1000);
    const endMs = startMs + Math.round(scene.duration * 1000);
    const role =
      index === 0
        ? 'hook'
        : index === plan.scenes.length - 1
          ? 'ending'
          : scene.punchIn
            ? 'insert'
            : 'body';
    return {
      cameraId: scene.camera_id,
      recordingId: scene.recording_id,
      sourceStartMs: startMs,
      sourceEndMs: Math.max(startMs + 1, endMs),
      role: sceneRoles.includes(role as (typeof sceneRoles)[number]) ? role : 'body',
      cropStrategy: scene.crop ? ('subject_focus' as const) : ('center_crop' as const),
      motion: mapLegacyMotion(scene.motion, scene.punchIn),
      transitionOut: mapLegacyTransition(scene.transition),
      importance: Math.round(Math.max(0, Math.min(100, 100 - index * 8))),
    };
  });
  const draft = {
    schemaVersion: '1.0' as const,
    tenantId: ids.tenantId,
    restaurantId: ids.restaurantId,
    momentId: ids.momentId,
    reelId: ids.reelId,
    program: plan.program as EditProgram,
    confidence: Math.round(Math.max(0, Math.min(100, Number(plan.confidence ?? plan.score ?? 70)))),
    scoreScale: '0-100' as const,
    durationTargetMs: Math.round(plan.duration * 1000),
    story: {
      type: 'experience',
      hookScore: Math.round(
        Math.max(0, Math.min(100, Number(plan.storyScore ?? plan.score ?? 70))),
      ),
      pace:
        brand?.preferredPace ??
        (plan.program === 'pulso' || plan.program === 'oficio'
          ? ('medium_fast' as const)
          : ('medium' as const)),
      emotion: 'premium_warm',
    },
    scenes,
    audio: {
      strategy: plan.audio ? ('original_audio' as const) : ('cinematic' as const),
      preserveAmbient: Boolean(plan.audio),
      originalGainDb: plan.audio ? -16 : null,
      musicGainDb: null,
      voiceGainDb: null,
    },
    text: {
      enabled: Boolean(plan.caption),
      title: plan.caption?.slice(0, 80) ?? null,
      subtitle: null,
      cta: brand?.cta?.slice(0, 40) ?? null,
    },
    captions: { strategy: 'none' as const },
    branding: { profileId: brand?.personality ?? null, showLogo: brand?.showLogo === true },
    qualityRequirements: { minimumVisualScore: 0 },
  };
  const parsed = parseVideoEditDecision(draft);
  if (parsed.success) return parsed.data;
  const repaired = repairVideoEditDecision(draft);
  if (repaired.success) return repaired.data;
  throw new Error('DIRECTOR_INVALID_OUTPUT');
}
