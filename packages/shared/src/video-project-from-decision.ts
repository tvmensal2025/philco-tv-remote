import type { SceneDecisionV2, VideoEditDecisionV2 } from './video-decision-v2.js';
import {
  createEmptyProject,
  createEntityId,
  defaultTracks,
  emptyColor,
  emptyTransform,
  type AiDecision,
  type MediaAsset,
  type TakeStatus,
  type ProjectClip,
  type TransitionType,
  type VideoProject,
} from './video-project.js';
import { makeVideoClip } from './video-project-ops.js';

export type ProjectSourceTake = {
  recordingId: string;
  cameraId: string;
  cameraPosition: number;
  cameraRole?: string;
  cameraLabel?: string;
  name?: string;
  durationMs?: number;
  hasAudio?: boolean;
  previewUrl?: string;
  objectPath?: string;
  scores?: MediaAsset['scores'];
};

const transitionMap: Record<string, TransitionType> = {
  hard_cut: 'cut',
  soft_dissolve: 'cross_dissolve',
  dip_to_black: 'dip_to_black',
  directional_push: 'push',
  masked_reveal: 'swipe',
};

function motionFromShot(shotStyle: string): ProjectClip['motion'] {
  if (
    shotStyle === 'slow_push' ||
    shotStyle === 'cinematic_food_closeup' ||
    shotStyle === 'hero_reveal'
  ) {
    return 'slow_push';
  }
  if (shotStyle === 'punch_in') return 'zoom_in';
  if (shotStyle === 'ambient_wide') return 'ken_burns';
  return 'none';
}

export function projectFromDecision(input: {
  decision: VideoEditDecisionV2;
  takes: ProjectSourceTake[];
  name?: string;
  rejected?: Array<{ cameraPosition?: number; recordingId?: string; reason?: string }>;
}): VideoProject {
  const { decision, takes } = input;
  const takeByRecording = new Map(takes.map((take) => [take.recordingId, take]));
  const takeByCamera = new Map(takes.map((take) => [take.cameraId, take]));
  const media: MediaAsset[] = takes.map((take) => ({
    id: `media_${take.recordingId}`,
    kind: 'video',
    name: take.name ?? take.cameraLabel ?? `C${take.cameraPosition}`,
    recordingId: take.recordingId,
    cameraId: take.cameraId,
    cameraPosition: take.cameraPosition,
    cameraLabel: take.cameraLabel ?? `C${take.cameraPosition}`,
    durationMs: take.durationMs ?? 0,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: take.hasAudio !== false,
    previewUrl: take.previewUrl,
    objectPath: take.objectPath,
    takeStatus: 'available',
    scores: take.scores,
  }));

  const used = new Set<string>();
  const decisions: AiDecision[] = [];
  let cursor = 0;
  const videoClips: ProjectClip[] = [];
  const audioClips: ProjectClip[] = [];

  decision.scenes.forEach((scene, index) => {
    const take =
      takeByRecording.get(scene.recordingId) ??
      takeByCamera.get(scene.cameraId) ??
      takes.find((item) => item.cameraPosition === scene.cameraPosition);
    const mediaId = take ? `media_${take.recordingId}` : `media_${scene.recordingId}`;
    used.add(mediaId);
    const sourceInMs = scene.sourceStartMs;
    const sourceOutMs = scene.sourceEndMs;
    const speed = scene.playbackSpeed ?? 1;
    const timelineDur = Math.round((sourceOutMs - sourceInMs) / speed);
    const transition = transitionMap[scene.transitionOut] ?? 'cut';
    const clip = makeVideoClip({
      mediaId,
      name: take?.cameraLabel ?? `C${scene.cameraPosition}`,
      sourceInMs,
      sourceOutMs,
      timelineStartMs: cursor,
      speed,
      ai: {
        sceneId: scene.sceneId,
        score: scene.importance,
        qualityScore: scene.cutSafetyScore ?? undefined,
        contentScore: scene.coherenceScore,
        motionScore: scene.cameraScore,
        reason: scene.reason,
        status: 'ai_selected',
      },
    });
    clip.timelineEndMs = cursor + timelineDur;
    clip.motion = motionFromShot(scene.shotStyle);
    if (scene.shotStyle === 'punch_in') {
      clip.transform = { ...emptyTransform(), scale: 1.08 };
    }
    if (index > 0 && transition !== 'cut') {
      clip.transitionIn = {
        type: transition,
        durationMs: transition === 'cross_dissolve' ? 500 : 350,
        easing: 'ease',
        intensity: 1,
        fxAssetId: scene.fxAssetId ?? null,
      };
    }
    if (scene.sceneRole === 'hook') clip.fadeInMs = 400;
    if (index === decision.scenes.length - 1) clip.fadeOutMs = 500;
    videoClips.push(clip);
    decisions.push({
      id: createEntityId('dec'),
      atMs: cursor,
      kind: 'select_take',
      mediaId,
      clipId: clip.id,
      reason: scene.reason || `Take ${clip.name} selecionado`,
      detail: `${scene.sceneRole} · ${scene.shotStyle} · ${((sourceOutMs - sourceInMs) / 1000).toFixed(1)}s`,
    });
    if (clip.motion !== 'none') {
      decisions.push({
        id: createEntityId('dec'),
        atMs: cursor,
        kind: 'zoom',
        clipId: clip.id,
        mediaId,
        reason: `Movimento ${clip.motion} para manter dinamismo`,
      });
    }
    if (clip.transitionIn) {
      decisions.push({
        id: createEntityId('dec'),
        atMs: cursor,
        kind: 'transition',
        clipId: clip.id,
        reason: `Transição ${clip.transitionIn.type}`,
      });
    }
    if (
      take?.hasAudio !== false &&
      decision.audio.preserveAmbient &&
      decision.audio.strategy !== 'music_only'
    ) {
      audioClips.push({
        ...clip,
        id: createEntityId('clip'),
        kind: 'audio',
        name: `${clip.name} áudio`,
        linkedClipId: clip.id,
        transform: emptyTransform(),
        color: emptyColor(),
        motion: 'none',
        effects: [],
        transitionIn: undefined,
        volume:
          decision.audio.originalGainDb == null
            ? 1
            : Math.max(0, 1 + decision.audio.originalGainDb / 20),
      });
    }
    cursor += timelineDur;
  });

  for (const row of input.rejected ?? []) {
    const take =
      takes.find((item) => item.recordingId === row.recordingId) ??
      takes.find((item) => item.cameraPosition === row.cameraPosition);
    if (!take) continue;
    const mediaId = `media_${take.recordingId}`;
    const asset = media.find((item) => item.id === mediaId);
    if (asset) {
      asset.takeStatus = 'rejected';
      asset.rejectReason = row.reason;
    }
    decisions.push({
      id: createEntityId('dec'),
      atMs: 0,
      kind: 'reject_take',
      mediaId,
      reason: row.reason || 'Take rejeitado',
    });
  }

  for (const asset of media) {
    if (used.has(asset.id)) asset.takeStatus = 'ai_selected';
    else if (asset.takeStatus !== 'rejected') asset.takeStatus = 'available';
  }

  const tracks = defaultTracks();
  const v1 = tracks.find((track) => track.id === 'track_v1')!;
  v1.clips = videoClips;
  const a1 = tracks.find((track) => track.id === 'track_a1')!;
  a1.clips = audioClips;
  if (decision.audio.strategy === 'music_only') a1.muted = true;

  const unusedMediaIds = media.filter((item) => !used.has(item.id)).map((item) => item.id);

  const project = createEmptyProject({
    name: input.name ?? decision.text.title ?? 'Projeto automático',
    reelId: decision.reelId,
    program: decision.program,
  });
  project.momentId = decision.momentId;
  project.restaurantId = decision.restaurantId;
  project.media = media;
  project.sequences[0] = {
    ...project.sequences[0]!,
    tracks,
    markers: videoClips.map((clip) => ({
      id: createEntityId('mk'),
      timeMs: clip.timelineStartMs,
      kind: 'cut' as const,
      label: clip.name,
    })),
  };
  project.branding = {
    showLogo: Boolean(decision.brandingProfileId),
    title: decision.text.title,
    subtitle: decision.text.subtitle,
    cta: decision.text.cta,
    endCard: true,
  };
  project.ai = {
    mode: 'balanced',
    decisions,
    unusedMediaIds,
    renderFromProject: true,
  };
  if (decision.captionStrategy === 'full' && decision.text.title) {
    project.captions = [
      {
        id: createEntityId('cap'),
        startMs: 0,
        endMs: Math.min(8000, cursor),
        text: decision.text.title,
      },
    ];
  }
  return project;
}

export function projectFromLegacyScenes(input: {
  reelId: string;
  program?: VideoProject['program'];
  name?: string;
  scenes: Array<{
    cam?: string;
    cameraId?: string;
    recordingId?: string | null;
    role?: string;
    desc?: string;
    offset?: number;
    duration?: number;
    transition?: string;
    punchIn?: boolean;
    motion?: string;
    fxAssetId?: string | null;
    playbackSpeed?: number;
    cameraScore?: number | null;
    coherenceScore?: number | null;
  }>;
  takes: ProjectSourceTake[];
  rejected?: Array<{ cameraPosition?: number; recordingId?: string; reason?: string }>;
}): VideoProject {
  const scenes: SceneDecisionV2[] = input.scenes.map((scene, index) => {
    const startMs = Math.round((scene.offset ?? 0) * 1000);
    const durationMs = Math.round((scene.duration ?? 1.9) * 1000);
    const position = Number(String(scene.cam ?? '').replace(/\D/g, '')) || index + 1;
    return {
      sceneId: `legacy-${index + 1}`,
      recordingId: scene.recordingId || scene.cameraId || `missing-${index}`,
      cameraId: scene.cameraId || scene.recordingId || `missing-${index}`,
      cameraPosition: Math.min(16, Math.max(1, position)),
      cameraRole: scene.role ?? 'master',
      sourceStartMs: startMs,
      sourceEndMs: startMs + Math.max(200, durationMs),
      sceneRole: index === 0 ? 'hook' : index === input.scenes.length - 1 ? 'ending' : 'a_roll',
      shotStyle: scene.punchIn
        ? 'punch_in'
        : scene.motion === 'drift'
          ? 'slow_push'
          : 'locked_static',
      reframeStrategy: 'static',
      primarySubjectRole: null,
      transitionOut:
        scene.transition === 'dissolve'
          ? 'soft_dissolve'
          : scene.transition === 'fadeblack'
            ? 'dip_to_black'
            : 'hard_cut',
      importance: scene.cameraScore ?? 70,
      cutSafetyScore: null,
      zoomEvents: [],
      reason: scene.desc,
      cameraScore: scene.cameraScore ?? undefined,
      coherenceScore: scene.coherenceScore ?? undefined,
      playbackSpeed: [0.5, 0.75, 1.5, 2].includes(scene.playbackSpeed ?? 1)
        ? (scene.playbackSpeed as 0.5 | 0.75 | 1.5 | 2)
        : 1,
      fxAssetId: scene.fxAssetId,
    };
  });
  const dummy: VideoEditDecisionV2 = {
    schemaVersion: '2.0',
    tenantId: '00000000-0000-4000-8000-000000000001',
    restaurantId: '00000000-0000-4000-8000-000000000002',
    momentId: '00000000-0000-4000-8000-000000000003',
    reelId: input.reelId,
    program: input.program ?? 'casa',
    scoreScale: '0-100',
    durationTargetMs: Math.max(
      1000,
      scenes.reduce((sum, scene) => sum + (scene.sourceEndMs - scene.sourceStartMs), 0),
    ),
    editingIntensity: 0.4,
    story: { type: 'experience', pace: 'medium', emotion: 'warm', hookStrength: 70 },
    scenes,
    audioStrategy: 'ambient_plus_music',
    brandingProfileId: null,
    captionStrategy: 'none',
    qualityRequirements: { minimumVisualScore: 0, minimumBrandScore: 0 },
    text: { enabled: false, title: input.name ?? null, subtitle: null, cta: null },
    audio: {
      strategy: 'ambient_plus_music',
      preserveAmbient: true,
      originalGainDb: 0,
      musicGainDb: -8,
      voiceGainDb: null,
    },
  };
  return projectFromDecision({
    decision: dummy,
    takes: input.takes,
    name: input.name,
    rejected: input.rejected,
  });
}

export function takeStatusLabel(status: TakeStatus) {
  if (status === 'used') return 'Usado';
  if (status === 'rejected') return 'Rejeitado';
  if (status === 'duplicate') return 'Duplicado';
  if (status === 'low_quality') return 'Baixa qualidade';
  if (status === 'incoherent') return 'Incoerente';
  if (status === 'ai_selected') return 'Selecionado pela IA';
  return 'Disponível';
}
