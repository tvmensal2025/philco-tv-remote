import { z } from 'zod';

const programs = ['casa', 'oficio', 'assinatura', 'pulso'] as const;
export type ProjectProgram = (typeof programs)[number];

export const VIDEO_PROJECT_VERSION = 1 as const;

export const aspectRatios = ['9:16', '16:9', '1:1', '4:5', 'custom'] as const;
export type AspectRatio = (typeof aspectRatios)[number];

export const aspectPresets = {
  'instagram-reel': { label: 'Instagram Reel', aspect: '9:16', width: 1080, height: 1920 },
  'instagram-story': { label: 'Instagram Story', aspect: '9:16', width: 1080, height: 1920 },
  tiktok: { label: 'TikTok', aspect: '9:16', width: 1080, height: 1920 },
  'youtube-shorts': { label: 'YouTube Shorts', aspect: '9:16', width: 1080, height: 1920 },
  youtube: { label: 'YouTube', aspect: '16:9', width: 1920, height: 1080 },
  feed: { label: 'Feed', aspect: '4:5', width: 1080, height: 1350 },
  square: { label: 'Quadrado', aspect: '1:1', width: 1080, height: 1080 },
} as const;

export const trackKinds = ['video', 'audio', 'text', 'overlay', 'fx'] as const;
export type TrackKind = (typeof trackKinds)[number];

export const mediaKinds = ['video', 'audio', 'image', 'logo'] as const;
export type MediaKind = (typeof mediaKinds)[number];

export const takeStatuses = [
  'used',
  'available',
  'rejected',
  'duplicate',
  'low_quality',
  'incoherent',
  'ai_selected',
] as const;
export type TakeStatus = (typeof takeStatuses)[number];

export const transitionTypes = [
  'cut',
  'cross_dissolve',
  'dip_to_black',
  'dip_to_white',
  'fade',
  'blur',
  'zoom',
  'push',
  'slide',
  'swipe',
  'whip',
  'spin',
  'flash',
  'camera_shake',
] as const;
export type TransitionType = (typeof transitionTypes)[number];

export const transitionLabels: Record<TransitionType, string> = {
  cut: 'Corte',
  cross_dissolve: 'Cross dissolve',
  dip_to_black: 'Dip to black',
  dip_to_white: 'Dip to white',
  fade: 'Fade',
  blur: 'Blur',
  zoom: 'Zoom',
  push: 'Push',
  slide: 'Slide',
  swipe: 'Swipe',
  whip: 'Whip',
  spin: 'Spin',
  flash: 'Flash',
  camera_shake: 'Camera shake',
};

export const motionPresets = [
  'none',
  'zoom_in',
  'zoom_out',
  'slow_push',
  'pan_left',
  'pan_right',
  'pan_up',
  'pan_down',
  'ken_burns',
  'handheld',
  'dynamic_crop',
] as const;
export type MotionPreset = (typeof motionPresets)[number];

export const automationModes = [
  'conservative',
  'balanced',
  'dynamic',
  'aggressive',
  'cinematic',
] as const;
export type AutomationMode = (typeof automationModes)[number];

export const automationModeLabels: Record<AutomationMode, string> = {
  conservative: 'Conservador',
  balanced: 'Equilibrado',
  dynamic: 'Dinâmico',
  aggressive: 'Agressivo',
  cinematic: 'Cinemático',
};

export function intensityForAutomationMode(mode: AutomationMode) {
  if (mode === 'conservative') return 0.15;
  if (mode === 'dynamic') return 0.62;
  if (mode === 'aggressive') return 0.88;
  if (mode === 'cinematic') return 0.28;
  return 0.4;
}

export const markerKinds = ['beat', 'cut', 'ai', 'user', 'problem', 'highlight'] as const;
export type MarkerKind = (typeof markerKinds)[number];

export const aiDecisionKinds = [
  'select_take',
  'reject_take',
  'cut',
  'trim',
  'reorder',
  'zoom',
  'crop',
  'transition',
  'remove_transition',
  'speed',
  'audio',
  'music',
  'caption',
  'effect',
  'lock_preserve',
] as const;
export type AiDecisionKind = (typeof aiDecisionKinds)[number];

const id = z.string().min(1).max(80);
const ms = z.number().int().min(0).max(3_600_000);

export function createEntityId(prefix: string) {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid}`;
}

export function msToFrame(timeMs: number, fps: number) {
  return Math.round((Math.max(0, timeMs) / 1000) * fps);
}

export function frameToMs(frame: number, fps: number) {
  return Math.round((Math.max(0, frame) / fps) * 1000);
}

export function snapMsToFrame(timeMs: number, fps: number) {
  return frameToMs(msToFrame(timeMs, fps), fps);
}

export function formatProjectTimecode(timeMs: number, fps = 30) {
  const frame = msToFrame(timeMs, fps);
  const totalSeconds = Math.floor(frame / fps);
  const frames = frame % fps;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export const keyframeSchema = z.object({
  timeMs: ms,
  value: z.number(),
  easing: z.enum(['linear', 'ease', 'ease_in', 'ease_out']).default('ease'),
});
export type Keyframe = z.infer<typeof keyframeSchema>;

export const transformSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  scale: z.number().min(0.1).max(8).default(1),
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  anchorX: z.number().min(0).max(1).default(0.5),
  anchorY: z.number().min(0).max(1).default(0.5),
  crop: z
    .object({
      x: z.number().min(0).max(1).default(0),
      y: z.number().min(0).max(1).default(0),
      width: z.number().min(0.05).max(1).default(1),
      height: z.number().min(0.05).max(1).default(1),
    })
    .optional(),
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
});
export type ClipTransform = z.infer<typeof transformSchema>;

export const colorGradeSchema = z.object({
  brightness: z.number().min(-1).max(1).default(0),
  contrast: z.number().min(-1).max(1).default(0),
  saturation: z.number().min(-1).max(1).default(0),
  exposure: z.number().min(-2).max(2).default(0),
  temperature: z.number().min(-1).max(1).default(0),
  tint: z.number().min(-1).max(1).default(0),
  highlights: z.number().min(-1).max(1).default(0),
  shadows: z.number().min(-1).max(1).default(0),
  sharpen: z.number().min(0).max(1).default(0),
  blur: z.number().min(0).max(40).default(0),
  vignette: z.number().min(0).max(1).default(0),
});
export type ColorGrade = z.infer<typeof colorGradeSchema>;

export const effectInstanceSchema = z.object({
  id,
  type: z.string().min(1).max(80),
  enabled: z.boolean().default(true),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  keyframes: z.record(z.array(keyframeSchema)).default({}),
});
export type EffectInstance = z.infer<typeof effectInstanceSchema>;

export const transitionSchema = z.object({
  type: z.enum(transitionTypes),
  durationMs: z.number().int().min(20).max(2500).default(400),
  easing: z.enum(['linear', 'ease', 'ease_in', 'ease_out']).default('ease'),
  intensity: z.number().min(0).max(1).default(1),
  direction: z.enum(['left', 'right', 'up', 'down', 'in', 'out']).optional(),
  fxAssetId: z.string().min(1).max(80).nullable().optional(),
});
export type ClipTransition = z.infer<typeof transitionSchema>;

export const textStyleSchema = z.object({
  content: z.string().max(240).default(''),
  role: z
    .enum([
      'title',
      'subtitle',
      'heading',
      'body',
      'cta',
      'lower_third',
      'price',
      'highlight',
      'end_card',
      'branding',
    ])
    .default('body'),
  fontFamily: z.string().max(80).default('Outfit'),
  fontSize: z.number().min(12).max(220).default(48),
  fontWeight: z.number().min(300).max(900).default(700),
  align: z.enum(['left', 'center', 'right']).default('center'),
  color: z.string().max(20).default('#ffffff'),
  background: z.string().max(20).nullable().default(null),
  stroke: z.string().max(20).nullable().default(null),
  shadow: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  tracking: z.number().min(-0.1).max(0.4).default(0),
  lineHeight: z.number().min(0.8).max(2).default(1.15),
  animationIn: z.enum(['none', 'fade', 'slide_up', 'scale']).default('fade'),
  animationOut: z.enum(['none', 'fade', 'slide_up', 'scale']).default('fade'),
});
export type TextStyle = z.infer<typeof textStyleSchema>;

export const clipAiSchema = z.object({
  sceneId: z.string().max(80).optional(),
  score: z.number().min(0).max(100).optional(),
  qualityScore: z.number().min(0).max(100).optional(),
  contentScore: z.number().min(0).max(100).optional(),
  motionScore: z.number().min(0).max(100).optional(),
  faceScore: z.number().min(0).max(100).optional(),
  foodScore: z.number().min(0).max(100).optional(),
  reason: z.string().max(400).optional(),
  status: z.enum(takeStatuses).optional(),
});
export type ClipAiMeta = z.infer<typeof clipAiSchema>;

export const timelineClipSchema = z
  .object({
    id,
    mediaId: z.string().min(1).max(80).nullable().default(null),
    name: z.string().max(120).default('Clip'),
    kind: z.enum(['video', 'audio', 'text', 'overlay']),
    sourceInMs: ms,
    sourceOutMs: z.number().int().positive().max(3_600_000),
    timelineStartMs: ms,
    timelineEndMs: z.number().int().positive().max(3_600_000),
    speed: z.number().min(0.25).max(4).default(1),
    reverse: z.boolean().default(false),
    volume: z.number().min(0).max(2).default(1),
    muted: z.boolean().default(false),
    fadeInMs: z.number().int().min(0).max(8_000).default(0),
    fadeOutMs: z.number().int().min(0).max(8_000).default(0),
    pan: z.number().min(-1).max(1).default(0),
    linkedClipId: z.string().max(80).nullable().optional(),
    transform: transformSchema.default({}),
    color: colorGradeSchema.default({}),
    motion: z.enum(motionPresets).default('none'),
    effects: z.array(effectInstanceSchema).max(24).default([]),
    transitionIn: transitionSchema.optional(),
    text: textStyleSchema.optional(),
    lockedByUser: z.boolean().default(false),
    disabled: z.boolean().default(false),
    ai: clipAiSchema.optional(),
  })
  .refine((clip) => clip.sourceOutMs > clip.sourceInMs, {
    message: 'sourceOutMs must be after sourceInMs',
    path: ['sourceOutMs'],
  })
  .refine((clip) => clip.timelineEndMs > clip.timelineStartMs, {
    message: 'timelineEndMs must be after timelineStartMs',
    path: ['timelineEndMs'],
  });
export type ProjectClip = z.infer<typeof timelineClipSchema>;

export const timelineTrackSchema = z.object({
  id,
  kind: z.enum(trackKinds),
  name: z.string().max(40),
  locked: z.boolean().default(false),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  hidden: z.boolean().default(false),
  clips: z.array(timelineClipSchema).max(200).default([]),
});
export type TimelineTrack = z.infer<typeof timelineTrackSchema>;

export const timelineMarkerSchema = z.object({
  id,
  timeMs: ms,
  kind: z.enum(markerKinds),
  label: z.string().max(80).default(''),
});
export type TimelineMarker = z.infer<typeof timelineMarkerSchema>;

export const sequenceSchema = z.object({
  id,
  name: z.string().max(80).default('Sequência 1'),
  tracks: z.array(timelineTrackSchema).min(1).max(32),
  markers: z.array(timelineMarkerSchema).max(200).default([]),
});
export type Sequence = z.infer<typeof sequenceSchema>;

export const mediaAssetSchema = z.object({
  id,
  kind: z.enum(mediaKinds),
  name: z.string().max(160),
  recordingId: z.string().max(80).optional(),
  cameraId: z.string().max(80).optional(),
  cameraPosition: z.number().int().min(1).max(16).optional(),
  cameraLabel: z.string().max(40).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).default(0),
  width: z.number().int().min(0).max(8_192).default(0),
  height: z.number().int().min(0).max(8_192).default(0),
  fps: z.number().min(0).max(120).default(30),
  hasAudio: z.boolean().default(true),
  objectPath: z.string().max(1000).optional(),
  previewUrl: z.string().max(2000).optional(),
  proxyUrl: z.string().max(2000).optional(),
  waveformUrl: z.string().max(2000).optional(),
  takeStatus: z.enum(takeStatuses).default('available'),
  scores: z
    .object({
      overall: z.number().min(0).max(100).optional(),
      quality: z.number().min(0).max(100).optional(),
      content: z.number().min(0).max(100).optional(),
      motion: z.number().min(0).max(100).optional(),
      face: z.number().min(0).max(100).optional(),
      food: z.number().min(0).max(100).optional(),
    })
    .optional(),
  rejectReason: z.string().max(400).optional(),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

export const captionCueSchema = z.object({
  id,
  startMs: ms,
  endMs: z.number().int().positive().max(3_600_000),
  text: z.string().max(280),
  words: z
    .array(
      z.object({
        text: z.string().max(40),
        startMs: ms,
        endMs: z.number().int().positive().max(3_600_000),
      }),
    )
    .max(80)
    .optional(),
});
export type CaptionCue = z.infer<typeof captionCueSchema>;

export const aiDecisionSchema = z.object({
  id,
  atMs: ms,
  kind: z.enum(aiDecisionKinds),
  mediaId: z.string().max(80).optional(),
  clipId: z.string().max(80).optional(),
  reason: z.string().max(400),
  detail: z.string().max(400).optional(),
});
export type AiDecision = z.infer<typeof aiDecisionSchema>;

export const projectSettingsSchema = z.object({
  fps: z.number().min(1).max(120).default(30),
  width: z.number().int().min(320).max(7680).default(1080),
  height: z.number().int().min(320).max(4320).default(1920),
  aspect: z.enum(aspectRatios).default('9:16'),
  timebase: z.number().int().min(1).max(120).default(30),
  safeAreas: z.boolean().default(true),
  snap: z.boolean().default(true),
  ripple: z.boolean().default(true),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export const exportSettingsSchema = z.object({
  resolution: z.enum(['720p', '1080p', '1440p', '4k']).default('1080p'),
  fps: z
    .union([
      z.literal('source'),
      z.literal(24),
      z.literal(25),
      z.literal(30),
      z.literal(50),
      z.literal(60),
    ])
    .default(30),
  format: z.enum(['mp4', 'webm']).default('mp4'),
  codec: z.enum(['h264', 'h265']).default('h264'),
  quality: z.enum(['draft', 'good', 'high', 'maximum', 'custom']).default('high'),
});
export type ExportSettings = z.infer<typeof exportSettingsSchema>;

export const videoProjectSchema = z.object({
  id,
  name: z.string().max(120).default('Sem título'),
  projectVersion: z.literal(VIDEO_PROJECT_VERSION),
  reelId: z.string().uuid().optional(),
  momentId: z.string().uuid().optional(),
  restaurantId: z.string().uuid().optional(),
  program: z.enum(programs).optional(),
  settings: projectSettingsSchema.default({}),
  media: z.array(mediaAssetSchema).max(400).default([]),
  sequences: z.array(sequenceSchema).min(1).max(8),
  captions: z.array(captionCueSchema).max(400).default([]),
  branding: z
    .object({
      showLogo: z.boolean().default(false),
      title: z.string().max(80).nullable().default(null),
      subtitle: z.string().max(120).nullable().default(null),
      cta: z.string().max(40).nullable().default(null),
      endCard: z.boolean().default(false),
    })
    .optional(),
  ai: z
    .object({
      mode: z.enum(automationModes).default('balanced'),
      decisions: z.array(aiDecisionSchema).max(400).default([]),
      unusedMediaIds: z.array(z.string()).max(400).default([]),
      quality: z
        .object({
          overall: z.number().min(0).max(100).optional(),
          hook: z.number().min(0).max(100).optional(),
          pacing: z.number().min(0).max(100).optional(),
          cuts: z.number().min(0).max(100).optional(),
          visual: z.number().min(0).max(100).optional(),
          audio: z.number().min(0).max(100).optional(),
          continuity: z.number().min(0).max(100).optional(),
        })
        .optional(),
      renderFromProject: z.boolean().default(false),
    })
    .optional(),
  export: exportSettingsSchema.default({}),
  updatedAt: z.string().datetime().optional(),
});
export type VideoProject = z.infer<typeof videoProjectSchema>;

export function parseVideoProject(input: unknown) {
  return videoProjectSchema.safeParse(input);
}

export function emptyTransform(): ClipTransform {
  return transformSchema.parse({});
}

export function emptyColor(): ColorGrade {
  return colorGradeSchema.parse({});
}

export function clipDurationMs(clip: Pick<ProjectClip, 'timelineStartMs' | 'timelineEndMs'>) {
  return Math.max(0, clip.timelineEndMs - clip.timelineStartMs);
}

export function sourceDurationMs(clip: Pick<ProjectClip, 'sourceInMs' | 'sourceOutMs'>) {
  return Math.max(0, clip.sourceOutMs - clip.sourceInMs);
}

export function activeSequence(project: VideoProject): Sequence {
  return project.sequences[0]!;
}

export function videoTracks(sequence: Sequence) {
  return sequence.tracks.filter((track) => track.kind === 'video');
}

export function audioTracks(sequence: Sequence) {
  return sequence.tracks.filter((track) => track.kind === 'audio');
}

export function sequenceDurationMs(sequence: Sequence) {
  let end = 0;
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (clip.disabled) continue;
      end = Math.max(end, clip.timelineEndMs);
    }
  }
  return end;
}

export function clipAtPlayhead(track: TimelineTrack, timeMs: number) {
  return (
    track.clips.find(
      (clip) => !clip.disabled && timeMs >= clip.timelineStartMs && timeMs < clip.timelineEndMs,
    ) ?? null
  );
}

export function sourceTimeForClip(clip: ProjectClip, timelineMs: number) {
  const local = Math.max(0, timelineMs - clip.timelineStartMs);
  const timelineDur = clipDurationMs(clip);
  const sourceDur = sourceDurationMs(clip);
  if (timelineDur <= 0) return clip.sourceInMs;
  const ratio = Math.min(1, local / timelineDur);
  const mapped = clip.reverse ? 1 - ratio : ratio;
  return Math.round(clip.sourceInMs + mapped * sourceDur);
}

export function defaultTracks(): TimelineTrack[] {
  return [
    {
      id: 'track_v2',
      kind: 'overlay',
      name: 'V2',
      locked: false,
      muted: false,
      solo: false,
      hidden: false,
      clips: [],
    },
    {
      id: 'track_v1',
      kind: 'video',
      name: 'V1',
      locked: false,
      muted: false,
      solo: false,
      hidden: false,
      clips: [],
    },
    {
      id: 'track_a1',
      kind: 'audio',
      name: 'A1 Original',
      locked: false,
      muted: false,
      solo: false,
      hidden: false,
      clips: [],
    },
    {
      id: 'track_a2',
      kind: 'audio',
      name: 'A2 Voice',
      locked: false,
      muted: false,
      solo: false,
      hidden: false,
      clips: [],
    },
    {
      id: 'track_a3',
      kind: 'audio',
      name: 'A3 Music',
      locked: false,
      muted: false,
      solo: false,
      hidden: false,
      clips: [],
    },
    {
      id: 'track_a4',
      kind: 'audio',
      name: 'A4 SFX',
      locked: false,
      muted: false,
      solo: false,
      hidden: false,
      clips: [],
    },
  ];
}

export function createEmptyProject(input?: {
  name?: string;
  reelId?: string;
  program?: ProjectProgram;
  aspect?: AspectRatio;
}): VideoProject {
  const aspect = input?.aspect ?? '9:16';
  const size =
    aspect === '16:9'
      ? { width: 1920, height: 1080 }
      : aspect === '1:1'
        ? { width: 1080, height: 1080 }
        : aspect === '4:5'
          ? { width: 1080, height: 1350 }
          : { width: 1080, height: 1920 };
  return videoProjectSchema.parse({
    id: createEntityId('proj'),
    name: input?.name ?? 'Novo projeto',
    projectVersion: VIDEO_PROJECT_VERSION,
    reelId: input?.reelId,
    program: input?.program,
    settings: { ...size, aspect, fps: 30, timebase: 30, safeAreas: true, snap: true, ripple: true },
    media: [],
    sequences: [
      {
        id: createEntityId('seq'),
        name: 'Sequência 1',
        tracks: defaultTracks(),
        markers: [],
      },
    ],
    captions: [],
    ai: { mode: 'balanced', decisions: [], unusedMediaIds: [], renderFromProject: false },
    export: {},
    updatedAt: new Date().toISOString(),
  });
}

export function cloneProject(project: VideoProject): VideoProject {
  return structuredClone(project);
}

export function findClip(project: VideoProject, clipId: string) {
  for (const track of activeSequence(project).tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function mediaById(project: VideoProject, mediaId: string | null | undefined) {
  if (!mediaId) return undefined;
  return project.media.find((item) => item.id === mediaId);
}

export function usedMediaIds(project: VideoProject) {
  const ids = new Set<string>();
  for (const track of activeSequence(project).tracks) {
    for (const clip of track.clips) {
      if (clip.mediaId) ids.add(clip.mediaId);
    }
  }
  return ids;
}
