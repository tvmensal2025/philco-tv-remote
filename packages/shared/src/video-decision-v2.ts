import { z } from 'zod';
import {
  audioStrategies,
  captionStrategies,
  sceneRoles,
  videoEditDecisionSchema,
  videoMotions,
  videoPaces,
  videoTransitions,
  type AudioStrategy,
  type VideoEditDecisionV1,
} from './video-decision.js';
import { defaultEditingIntensityForProgram } from './edit-intensity.js';
import { snapPlaybackSpeed } from './fx-catalog.js';

export const DIRECTOR_SCHEMA_VERSION_V2 = '2.0';

export const storyTypes = ['experience', 'process', 'signature', 'energy', 'service'] as const;
export type StoryType = (typeof storyTypes)[number];

export const sceneRoleV2 = [
  'hook',
  'hero',
  'a_roll',
  'b_roll',
  'establishing',
  'action',
  'reaction',
  'transition',
  'ending',
] as const;
export type SceneRole = (typeof sceneRoleV2)[number];

export const shotStyles = [
  'cinematic_food_closeup',
  'slow_push',
  'locked_static',
  'ambient_wide',
  'hero_reveal',
  'tracked_subject',
  'reaction',
  'chef_action',
  'serving_action',
  'punch_in',
  'minimal',
] as const;
export type ShotStyle = (typeof shotStyles)[number];

export const reframeStrategies = [
  'static',
  'tracked_subject',
  'food_and_person',
  'cinematic_pan',
  'wide_safe',
] as const;
export type ReframeStrategy = (typeof reframeStrategies)[number];

export const subjectRoles = [
  'food',
  'person',
  'food_and_person',
  'chef',
  'server',
  'reaction',
  'environment',
] as const;
export type SubjectRole = (typeof subjectRoles)[number];

export const zoomReasons = [
  'dish_reveal',
  'plating_completion',
  'chef_action',
  'customer_reaction',
  'toast',
  'brand_emphasis',
  'hook',
] as const;

const score = z.number().int().min(0).max(100);

export const zoomEventSchema = z
  .object({
    startMs: z.number().int().min(0).max(3_600_000),
    endMs: z.number().int().positive().max(3_600_000),
    from: z.number().min(1).max(1.3).default(1),
    to: z.number().min(1).max(1.3),
    reason: z.enum(zoomReasons),
    curve: z.enum(['linear', 'ease']).default('ease'),
  })
  .refine((event) => event.endMs > event.startMs, {
    message: 'zoom endMs must be after startMs',
    path: ['endMs'],
  });
export type ZoomEvent = z.infer<typeof zoomEventSchema>;

export const sceneDecisionV2Schema = z
  .object({
    sceneId: z.string().uuid(),
    recordingId: z.string().min(1),
    cameraId: z.string().min(1),
    cameraPosition: z.number().int().min(1).max(16),
    cameraRole: z.string().min(1).max(40),
    sourceStartMs: z.number().int().min(0).max(3_600_000),
    sourceEndMs: z.number().int().positive().max(3_600_000),
    sceneRole: z.enum(sceneRoleV2),
    shotStyle: z.enum(shotStyles).default('locked_static'),
    reframeStrategy: z.enum(reframeStrategies).default('static'),
    primarySubjectRole: z.enum(subjectRoles).nullable().default(null),
    transitionOut: z.enum(videoTransitions).default('hard_cut'),
    importance: score.default(50),
    cutSafetyScore: score.nullable().default(null),
    zoomEvents: z.array(zoomEventSchema).max(8).default([]),
    reason: z.string().max(220).optional(),
    cameraScore: score.optional(),
    coherenceScore: score.optional(),
    playbackSpeed: z
      .union([z.literal(0.5), z.literal(0.75), z.literal(1), z.literal(1.5), z.literal(2)])
      .optional(),
    fxAssetId: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .refine((scene) => scene.sourceEndMs > scene.sourceStartMs, {
    message: 'sourceEndMs must be after sourceStartMs',
    path: ['sourceEndMs'],
  });
export type SceneDecisionV2 = z.infer<typeof sceneDecisionV2Schema>;

export const videoEditDecisionV2Schema = z.object({
  schemaVersion: z.literal('2.0'),
  tenantId: z.string().uuid(),
  restaurantId: z.string().uuid(),
  momentId: z.string().uuid(),
  reelId: z.string().uuid().optional(),
  program: z.enum(['casa', 'oficio', 'assinatura', 'pulso']),
  scoreScale: z.literal('0-100'),
  durationTargetMs: z.number().int().min(1000).max(180_000),
  editingIntensity: z.number().min(0).max(1),
  story: z.object({
    type: z.string().min(1).max(40),
    pace: z.enum(videoPaces),
    emotion: z.string().min(1).max(40),
    hookStrength: score,
  }),
  scenes: z.array(sceneDecisionV2Schema).min(1).max(16),
  audioStrategy: z.enum(audioStrategies),
  brandingProfileId: z.string().uuid().nullable(),
  captionStrategy: z.enum(captionStrategies),
  qualityRequirements: z.object({
    minimumVisualScore: score.default(0),
    minimumBrandScore: score.default(0),
  }),
  editMode: z.enum(['single_camera', 'dual_camera', 'multicamera']).optional(),
  text: z.object({
    enabled: z.boolean(),
    title: z.string().max(80).nullable(),
    subtitle: z.string().max(120).nullable(),
    cta: z.string().max(40).nullable(),
  }),
  audio: z.object({
    strategy: z.enum(audioStrategies),
    preserveAmbient: z.boolean(),
    originalGainDb: z.number().min(-60).max(12).nullable(),
    musicGainDb: z.number().min(-60).max(12).nullable(),
    voiceGainDb: z.number().min(-60).max(12).nullable(),
  }),
});

export type VideoEditDecisionV2 = z.infer<typeof videoEditDecisionV2Schema>;

export function parseVideoEditDecisionV2(input: unknown) {
  return videoEditDecisionV2Schema.safeParse(input);
}

function clampScore(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 70;
  const scaled = n > 0 && n < 1 ? n * 100 : n;
  return Math.min(100, Math.max(0, Math.round(scaled)));
}

function msFromModel(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 3_600_000) return Math.min(3_600_000, Math.round(n));
  if (n > 0 && n < 1000) return Math.round(n * 1000);
  return Math.round(n);
}

function sceneIdFromIndex(index: number) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

export function mapV1RoleToSceneRole(role: string, index: number, last: number): SceneRole {
  if (role === 'hook') return 'hook';
  if (role === 'ending') return 'ending';
  if (role === 'payoff') return 'hero';
  if (role === 'insert') return 'b_roll';
  if (index === 0) return 'hook';
  if (index === last) return 'ending';
  return 'a_roll';
}

export function mapV1MotionToShotStyle(motion: string, role: string): ShotStyle {
  if (motion === 'punch_in') return 'punch_in';
  if (motion === 'slow_push') return role === 'food' ? 'cinematic_food_closeup' : 'slow_push';
  if (motion === 'subject_focus') return 'tracked_subject';
  if (motion === 'subtle_pan') return 'ambient_wide';
  if (role === 'food') return 'cinematic_food_closeup';
  if (role === 'ambience') return 'ambient_wide';
  return 'locked_static';
}

export function mapV1CropToReframe(crop: string): ReframeStrategy {
  if (crop === 'subject_focus') return 'tracked_subject';
  if (crop === 'pad_blur') return 'wide_safe';
  return 'static';
}

export function adaptVideoEditDecisionV1ToV2(decision: VideoEditDecisionV1): VideoEditDecisionV2 {
  const last = Math.max(0, decision.scenes.length - 1);
  const draft = {
    schemaVersion: '2.0' as const,
    tenantId: decision.tenantId,
    restaurantId: decision.restaurantId,
    momentId: decision.momentId ?? '00000000-0000-4000-8000-000000000001',
    reelId: decision.reelId,
    program: decision.program,
    scoreScale: '0-100' as const,
    durationTargetMs: decision.durationTargetMs,
    editingIntensity: defaultEditingIntensityForProgram(decision.program),
    story: {
      type: decision.story.type,
      pace: decision.story.pace,
      emotion: decision.story.emotion,
      hookStrength: decision.story.hookScore,
    },
    scenes: decision.scenes.map((scene, index) => ({
      sceneId: sceneIdFromIndex(index),
      recordingId: scene.recordingId ?? scene.cameraId,
      cameraId: scene.cameraId,
      cameraPosition: Math.min(16, Math.max(1, index + 1)),
      cameraRole: 'master',
      sourceStartMs: scene.sourceStartMs,
      sourceEndMs: scene.sourceEndMs,
      sceneRole: mapV1RoleToSceneRole(scene.role, index, last),
      shotStyle: mapV1MotionToShotStyle(scene.motion, scene.role),
      reframeStrategy: mapV1CropToReframe(scene.cropStrategy),
      primarySubjectRole: null,
      transitionOut: scene.transitionOut,
      importance: scene.importance,
      cutSafetyScore: null,
      zoomEvents: [],
    })),
    audioStrategy: decision.audio.strategy,
    brandingProfileId: null,
    captionStrategy: decision.captions.strategy,
    qualityRequirements: {
      minimumVisualScore: decision.qualityRequirements.minimumVisualScore,
      minimumBrandScore: 0,
    },
    text: decision.text,
    audio: decision.audio,
  };
  const parsed = videoEditDecisionV2Schema.safeParse(draft);
  if (!parsed.success) throw new Error('DIRECTOR_INVALID_OUTPUT');
  return parsed.data;
}

export function videoEditDecisionV2ToV1(decision: VideoEditDecisionV2): VideoEditDecisionV1 {
  const roleMap: Record<SceneRole, (typeof sceneRoles)[number]> = {
    hook: 'hook',
    hero: 'payoff',
    a_roll: 'body',
    b_roll: 'insert',
    establishing: 'body',
    action: 'body',
    reaction: 'insert',
    transition: 'insert',
    ending: 'ending',
  };
  const motionMap: Record<ShotStyle, (typeof videoMotions)[number]> = {
    cinematic_food_closeup: 'slow_push',
    slow_push: 'slow_push',
    locked_static: 'none',
    ambient_wide: 'subtle_pan',
    hero_reveal: 'slow_push',
    tracked_subject: 'subject_focus',
    reaction: 'none',
    chef_action: 'none',
    serving_action: 'none',
    punch_in: 'punch_in',
    minimal: 'none',
  };
  const draft = {
    schemaVersion: '1.0' as const,
    tenantId: decision.tenantId,
    restaurantId: decision.restaurantId,
    momentId: decision.momentId,
    reelId: decision.reelId,
    program: decision.program,
    confidence: decision.story.hookStrength,
    scoreScale: '0-100' as const,
    durationTargetMs: decision.durationTargetMs,
    story: {
      type: decision.story.type,
      hookScore: decision.story.hookStrength,
      pace: decision.story.pace,
      emotion: decision.story.emotion,
    },
    scenes: decision.scenes.map((scene) => ({
      recordingId: scene.recordingId,
      cameraId: scene.cameraId,
      sourceStartMs: scene.sourceStartMs,
      sourceEndMs: scene.sourceEndMs,
      role: roleMap[scene.sceneRole],
      cropStrategy:
        scene.reframeStrategy === 'tracked_subject' || scene.reframeStrategy === 'food_and_person'
          ? ('subject_focus' as const)
          : scene.reframeStrategy === 'wide_safe'
            ? ('pad_blur' as const)
            : ('center_crop' as const),
      motion: motionMap[scene.shotStyle],
      transitionOut: scene.transitionOut,
      importance: scene.importance,
    })),
    audio: decision.audio,
    text: decision.text,
    captions: { strategy: decision.captionStrategy },
    branding: {
      profileId: decision.brandingProfileId,
      showLogo: Boolean(decision.brandingProfileId),
    },
    qualityRequirements: { minimumVisualScore: decision.qualityRequirements.minimumVisualScore },
  };
  return videoEditDecisionSchema.parse(draft);
}

export function repairVideoEditDecisionV2(input: unknown) {
  const first = videoEditDecisionV2Schema.safeParse(input);
  if (first.success) return first;
  if (!input || typeof input !== 'object') return first;
  const raw = { ...(input as Record<string, unknown>) };
  raw.schemaVersion = '2.0';
  raw.scoreScale = '0-100';
  raw.durationTargetMs = msFromModel(raw.durationTargetMs) || 12_000;
  if (Number(raw.durationTargetMs) < 1000) raw.durationTargetMs = 12_000;
  const intensity = Number(raw.editingIntensity);
  raw.editingIntensity = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0.4;
  if (raw.story && typeof raw.story === 'object') {
    const story = { ...(raw.story as Record<string, unknown>) };
    story.hookStrength = clampScore(story.hookStrength ?? story.hookScore);
    story.type = String(story.type ?? 'experience').slice(0, 40);
    story.emotion = String(story.emotion ?? 'premium_warm').slice(0, 40);
    if (!videoPaces.includes(story.pace as (typeof videoPaces)[number])) story.pace = 'medium';
    raw.story = story;
  }
  if (Array.isArray(raw.scenes)) {
    const incoming = raw.scenes as unknown[];
    raw.scenes = incoming.slice(0, 16).map((scene, index) => {
      const item =
        scene && typeof scene === 'object' ? { ...(scene as Record<string, unknown>) } : {};
      if (typeof item.sceneId !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.sceneId))
        item.sceneId = sceneIdFromIndex(index);
      item.sourceStartMs = msFromModel(item.sourceStartMs);
      item.sourceEndMs = Math.max(Number(item.sourceStartMs) + 1, msFromModel(item.sourceEndMs));
      item.cameraId = String(item.cameraId ?? '');
      item.recordingId = String(item.recordingId ?? item.cameraId);
      item.cameraPosition = Math.min(16, Math.max(1, Number(item.cameraPosition) || index + 1));
      item.cameraRole = String(item.cameraRole ?? 'master').slice(0, 40);
      if (!sceneRoleV2.includes(item.sceneRole as SceneRole)) {
        item.sceneRole = mapV1RoleToSceneRole(
          String(item.role ?? item.sceneRole ?? 'body'),
          index,
          incoming.length - 1,
        );
      }
      if (!shotStyles.includes(item.shotStyle as ShotStyle)) {
        item.shotStyle = mapV1MotionToShotStyle(
          String(item.motion ?? 'none'),
          String(item.cameraRole),
        );
      }
      if (!reframeStrategies.includes(item.reframeStrategy as ReframeStrategy))
        item.reframeStrategy = 'static';
      if (!videoTransitions.includes(item.transitionOut as (typeof videoTransitions)[number]))
        item.transitionOut = 'hard_cut';
      item.importance = clampScore(item.importance);
      if (item.cutSafetyScore != null) item.cutSafetyScore = clampScore(item.cutSafetyScore);
      if (!Array.isArray(item.zoomEvents)) item.zoomEvents = [];
      if (item.primarySubjectRole === undefined) item.primarySubjectRole = null;
      item.playbackSpeed = snapPlaybackSpeed(item.playbackSpeed);
      if (typeof item.fxAssetId === 'string' && item.fxAssetId.trim()) {
        item.fxAssetId = item.fxAssetId.trim().slice(0, 80);
      } else {
        item.fxAssetId = null;
      }
      return item;
    });
  }
  if (!audioStrategies.includes(raw.audioStrategy as AudioStrategy)) {
    const audio =
      raw.audio && typeof raw.audio === 'object' ? (raw.audio as Record<string, unknown>) : {};
    raw.audioStrategy = audioStrategies.includes(audio.strategy as AudioStrategy)
      ? audio.strategy
      : 'original_audio';
  }
  if (!raw.audio || typeof raw.audio !== 'object') {
    raw.audio = {
      strategy: raw.audioStrategy,
      preserveAmbient: true,
      originalGainDb: -16,
      musicGainDb: null,
      voiceGainDb: null,
    };
  }
  if (!raw.text || typeof raw.text !== 'object') {
    raw.text = { enabled: false, title: null, subtitle: null, cta: null };
  }
  if (!captionStrategies.includes(raw.captionStrategy as (typeof captionStrategies)[number]))
    raw.captionStrategy = 'none';
  if (raw.brandingProfileId === undefined) raw.brandingProfileId = null;
  if (!raw.qualityRequirements || typeof raw.qualityRequirements !== 'object') {
    raw.qualityRequirements = { minimumVisualScore: 0, minimumBrandScore: 0 };
  }
  return videoEditDecisionV2Schema.safeParse(raw);
}
