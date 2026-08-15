import {
  adaptVideoEditDecisionV1ToV2,
  parseVideoEditDecision,
  parseVideoEditDecisionV2,
  repairVideoEditDecision,
  repairVideoEditDecisionV2,
  type RestaurantVideoBrandProfile,
  type VideoEditDecisionV2,
} from '@reelops/shared';
import { config } from '../config.js';
import { log } from '../services.js';
import type { ReelPlan } from './planner.js';
import { decisionFromReelPlan } from './director.js';
import {
  directorCandidatesFromClips,
  repairDirectorReferences,
  validateDirectorReferences,
  type DirectorCandidate,
} from './scene-resolver.js';
import { loadFxCatalogFromDisk } from '../pipeline/fx-assets.js';
import type { ClipCandidate } from '../adapters/analyzer.js';

export type DirectorInput = {
  plan: ReelPlan;
  clips: ClipCandidate[];
  ids: { tenantId: string; restaurantId: string; momentId: string; reelId: string };
  brand?: RestaurantVideoBrandProfile;
  cameraRank?: Array<{ cameraPosition: number; cameraRole: string; score: number }>;
  coherence?: {
    recommendedMode: string;
    primaryCameraId: string;
    compatibleCameraIds: string[];
    rejected: Array<{ cameraId: string; cameraPosition: number; reason: string }>;
    multicameraConfidence: number;
  };
};

const playbooks: Record<string, string> = {
  casa: 'CASA: premium restaurant reel. Camera role is a weak prior, never a requirement. Hook MUST be the strongest compatible image. If SceneCoherenceGate recommends single_camera, use that camera for the whole reel. Do not reintroduce rejected cameras. Do not cut to another camera just for variety. More scenes on the SAME camera are valid when the picture changes (prep, action, interaction, detail, payoff, exit). If the source is strong, explore windowStartMs→windowEndMs instead of clustering every take in the opening seconds. Weak or repetitive picture may stay short. Do not invent a target duration. Neutral copy only — omit text if unsure. Never invent cuisine, city or ingredients. Full-screen title cards before the first frame are forbidden.',
  oficio: 'OFÍCIO constraints: process, team, kitchen, prep, action. Prefer side/kitchen cameras.',
  assinatura:
    'ASSINATURA constraints: food hero, plating, dish detail. Prefer food camera unless that angle is blocked.',
  pulso: 'PULSO constraints: energy, movement, faster cuts, action. Still never invent cameras.',
};

function parseDecision(
  raw: unknown,
  ids: DirectorInput['ids'],
  program: ReelPlan['program'],
  fallbackV1: ReturnType<typeof decisionFromReelPlan>,
): VideoEditDecisionV2 {
  const merged = { ...(raw as object), schemaVersion: '2.0', scoreScale: '0-100', ...ids, program };
  let parsed = parseVideoEditDecisionV2(merged);
  if (!parsed.success) parsed = repairVideoEditDecisionV2(merged);
  if (parsed.success) return parsed.data;
  const v1 = parseVideoEditDecision({
    ...fallbackV1,
    ...(raw as object),
    schemaVersion: '1.0',
    scoreScale: '0-100',
    ...ids,
    program,
  });
  const repairedV1 = v1.success
    ? v1
    : repairVideoEditDecision({
        ...fallbackV1,
        ...(raw as object),
        schemaVersion: '1.0',
        scoreScale: '0-100',
        ...ids,
        program,
      });
  if (!repairedV1.success) throw new Error('DIRECTOR_INVALID_OUTPUT');
  return adaptVideoEditDecisionV1ToV2(repairedV1.data);
}

export async function decideWithAiDirector(input: DirectorInput): Promise<{
  decision: VideoEditDecisionV2;
  latencyMs: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model: string;
}> {
  if (!config.OPENAI_API_KEY) throw new Error('DIRECTOR_INVALID_OUTPUT:openai_missing');
  const candidates: DirectorCandidate[] = directorCandidatesFromClips(input.clips);
  if (!candidates.length) throw new Error('DIRECTOR_INVALID_REFERENCE');
  const legacy = adaptVideoEditDecisionV1ToV2(
    decisionFromReelPlan(input.plan, input.ids, input.brand),
  );
  const started = Date.now();
  const body = {
    model: config.OPENAI_MODEL,
    temperature: 0.2,
    max_tokens: 1600,
    response_format: { type: 'json_object' as const },
    messages: [
      {
        role: 'system',
        content:
          'Return only VideoEditDecisionV2 JSON. schemaVersion=2.0 scoreScale=0-100. cameraId and recordingId MUST be copied from candidates (real UUIDs). cameraLabel like C4 is display-only and MUST NOT be used as cameraId or recordingId. sourceStartMs/sourceEndMs are milliseconds relative to the recording, never Unix time. playbackSpeed only 0.5, 0.75, 1, 1.5 or 2. At most one slow-mo (0.5/0.75) per reel unless durationTargetMs>=55000 (then two). Never slow a static plate. Never speed-up a food punch-in. fxAssetId must be copied from fxCatalog or omitted. Casa: no smash. Do not invent UUIDs, prices, discounts, ingredients, awards or dates. If only one camera is in candidates, that is valid — use it. Neutral title if unsure, or null. No markdown.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          playbook: playbooks[input.plan.program] ?? playbooks.casa,
          program: input.plan.program,
          durationTargetMs: input.plan.duration * 1000,
          fxCatalog: loadFxCatalogFromDisk().assets.map((asset) => ({
            id: asset.id,
            pack: asset.pack,
            role: asset.role,
            tags: asset.tags,
          })),
          fxBudget: {
            maxJoinPacks: input.plan.program === 'casa' ? 1 : input.plan.duration >= 55 ? 3 : 2,
            maxSmash: input.plan.program === 'casa' ? 0 : 1,
            maxLens: 1,
            maxSlowMo: input.plan.duration >= 55 ? 2 : 1,
          },
          brand: input.brand ?? null,
          candidates: candidates.map((item) => ({
            cameraId: item.cameraId,
            recordingId: item.recordingId,
            cameraPosition: item.cameraPosition,
            cameraRole: item.cameraRole,
            cameraLabel: item.cameraLabel,
            windowStartMs: Math.round(item.startOffsetSeconds * 1000),
            windowEndMs: Math.round((item.startOffsetSeconds + item.windowDurationSeconds) * 1000),
          })),
          sceneCoherence: input.coherence ?? null,
          singleCameraExploration:
            input.coherence?.recommendedMode === 'single_camera'
              ? {
                  keepSameCamera: true,
                  exploreAvailableInterval: true,
                  allowMoreScenesOnSameCamera: true,
                  lookFor:
                    'action change, beginning/middle/end, preparation, interaction, payoff, interesting motion, visual variation',
                  doNotClusterInTheFirstSeconds: true,
                  noFixedDuration: true,
                }
              : null,
          vision: {
            provider: input.plan.provider,
            model: input.plan.model,
            score: input.plan.score,
            reason: input.plan.reason,
            detailedScores: input.plan.detailedScores,
            cameraRankings: input.plan.cameraRankings,
            bestFrames: input.plan.bestFrames,
            caption: input.plan.caption,
            multicameraRanker: input.cameraRank ?? null,
            rejectedCameras: input.coherence?.rejected ?? [],
            recommendedEditMode: input.coherence?.recommendedMode ?? null,
          },
          legacyDecision: legacy,
          ids: input.ids,
        }),
      },
    ],
  };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!response.ok)
    throw new Error(`DIRECTOR_INVALID_OUTPUT:${payload.error?.message ?? response.status}`);
  const rawContent = payload.choices?.[0]?.message?.content ?? '{}';
  let raw: unknown;
  try {
    const stripped = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '');
    raw = JSON.parse(stripped);
  } catch {
    throw new Error('DIRECTOR_INVALID_OUTPUT:json');
  }
  let decision: VideoEditDecisionV2;
  try {
    decision = parseDecision(
      raw,
      input.ids,
      input.plan.program,
      decisionFromReelPlan(input.plan, input.ids, input.brand),
    );
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : error },
      'ai director parse failed; keeping valid candidate refs',
    );
    decision = legacy;
  }
  decision = repairDirectorReferences(decision, candidates);
  validateDirectorReferences(decision, candidates);
  log.info(
    {
      provider: 'openai',
      model: config.OPENAI_MODEL,
      latency_ms: Date.now() - started,
      prompt_tokens: payload.usage?.prompt_tokens,
      completion_tokens: payload.usage?.completion_tokens,
      program: input.plan.program,
      scenes: decision.scenes.length,
      cameras: decision.scenes.map((scene) => scene.cameraId),
    },
    'ai director',
  );
  return {
    decision,
    latencyMs: Date.now() - started,
    usage: payload.usage,
    model: config.OPENAI_MODEL,
  };
}
