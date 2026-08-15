import { describe, expect, it } from 'vitest';
import { compileErrorMessage, compileVideoProject } from './video-project-compiler.js';
import { projectFromDecision, projectFromLegacyScenes } from './video-project-from-decision.js';
import {
  appendClipToTrack,
  createHistory,
  deleteClip,
  detachAudio,
  duplicateClip,
  makeVideoClip,
  moveClip,
  preserveLockedClips,
  pushHistory,
  redoProject,
  setClipLocked,
  setClipVolume,
  setTransitionIn,
  splitClipAtPlayhead,
  snapTimeMs,
  trimClip,
  undoProject,
} from './video-project-ops.js';
import { previewProjectAt } from './video-project-preview.js';
import {
  VIDEO_PROJECT_VERSION,
  createEmptyProject,
  formatProjectTimecode,
  parseVideoProject,
  sequenceDurationMs,
  snapMsToFrame,
  activeSequence,
} from './video-project.js';
import type { VideoEditDecisionV2 } from './video-decision-v2.js';

function sampleDecision(): VideoEditDecisionV2 {
  return {
    schemaVersion: '2.0',
    tenantId: '11111111-1111-4111-8111-111111111111',
    restaurantId: '22222222-2222-4222-8222-222222222222',
    momentId: '33333333-3333-4333-8333-333333333333',
    reelId: '44444444-4444-4444-8444-444444444444',
    program: 'pulso',
    scoreScale: '0-100',
    durationTargetMs: 12_000,
    editingIntensity: 0.8,
    story: { type: 'energy', pace: 'fast', emotion: 'pulse', hookStrength: 88 },
    scenes: [
      {
        sceneId: '00000000-0000-4000-8000-000000000001',
        recordingId: 'rec-1',
        cameraId: 'cam-1',
        cameraPosition: 1,
        cameraRole: 'master',
        sourceStartMs: 1000,
        sourceEndMs: 4200,
        sceneRole: 'hook',
        shotStyle: 'slow_push',
        reframeStrategy: 'static',
        primarySubjectRole: null,
        transitionOut: 'hard_cut',
        importance: 91,
        cutSafetyScore: 80,
        zoomEvents: [],
        reason: 'Maior clareza visual + movimento',
        cameraScore: 91,
        coherenceScore: 84,
        playbackSpeed: 1,
      },
      {
        sceneId: '00000000-0000-4000-8000-000000000002',
        recordingId: 'rec-3',
        cameraId: 'cam-3',
        cameraPosition: 3,
        cameraRole: 'food',
        sourceStartMs: 5400,
        sourceEndMs: 8900,
        sceneRole: 'hero',
        shotStyle: 'punch_in',
        reframeStrategy: 'static',
        primarySubjectRole: 'food',
        transitionOut: 'soft_dissolve',
        importance: 94,
        cutSafetyScore: 77,
        zoomEvents: [],
        reason: 'Prato nítido no pico de ação',
        cameraScore: 94,
        playbackSpeed: 1,
      },
      {
        sceneId: '00000000-0000-4000-8000-000000000003',
        recordingId: 'rec-2',
        cameraId: 'cam-2',
        cameraPosition: 2,
        cameraRole: 'side',
        sourceStartMs: 11_200,
        sourceEndMs: 15_100,
        sceneRole: 'ending',
        shotStyle: 'locked_static',
        reframeStrategy: 'static',
        primarySubjectRole: null,
        transitionOut: 'hard_cut',
        importance: 70,
        cutSafetyScore: 72,
        zoomEvents: [],
        reason: 'Fecha no ofício',
        cameraScore: 70,
        playbackSpeed: 1,
      },
    ],
    audioStrategy: 'ambient_plus_music',
    brandingProfileId: null,
    captionStrategy: 'full',
    qualityRequirements: { minimumVisualScore: 0, minimumBrandScore: 0 },
    text: { enabled: true, title: 'No balcão', subtitle: null, cta: null },
    audio: {
      strategy: 'ambient_plus_music',
      preserveAmbient: true,
      originalGainDb: 0,
      musicGainDb: -8,
      voiceGainDb: null,
    },
  };
}

const takes = [
  {
    recordingId: 'rec-1',
    cameraId: 'cam-1',
    cameraPosition: 1,
    cameraLabel: 'C1 Serviço',
    durationMs: 60_000,
    hasAudio: true,
  },
  {
    recordingId: 'rec-2',
    cameraId: 'cam-2',
    cameraPosition: 2,
    cameraLabel: 'C2 Cozinha',
    durationMs: 60_000,
    hasAudio: true,
  },
  {
    recordingId: 'rec-3',
    cameraId: 'cam-3',
    cameraPosition: 3,
    cameraLabel: 'C3 Prato',
    durationMs: 60_000,
    hasAudio: true,
  },
  {
    recordingId: 'rec-4',
    cameraId: 'cam-4',
    cameraPosition: 4,
    cameraLabel: 'C4 Sala',
    durationMs: 60_000,
    hasAudio: true,
  },
];

describe('video project core', () => {
  it('creates a versioned empty project with video and audio tracks', () => {
    const project = createEmptyProject({ name: 'Manual' });
    expect(project.projectVersion).toBe(VIDEO_PROJECT_VERSION);
    expect(parseVideoProject(project).success).toBe(true);
    expect(activeSequence(project).tracks.map((track) => track.name)).toEqual([
      'V2',
      'V1',
      'A1 Original',
      'A2 Voice',
      'A3 Music',
      'A4 SFX',
    ]);
    expect(formatProjectTimecode(1500, 30)).toBe('00:01:15');
    expect(snapMsToFrame(33, 30)).toBe(33);
  });

  it('turns a director decision into editable clips, not a baked mp4', () => {
    const project = projectFromDecision({
      decision: sampleDecision(),
      takes,
      rejected: [{ cameraPosition: 4, reason: 'Baixa coerência visual' }],
    });
    const v1 = activeSequence(project).tracks.find((track) => track.id === 'track_v1')!;
    expect(v1.clips).toHaveLength(3);
    expect(v1.clips[0]?.sourceInMs).toBe(1000);
    expect(v1.clips[0]?.sourceOutMs).toBe(4200);
    expect(v1.clips[1]?.sourceInMs).toBe(5400);
    expect(v1.clips[1]?.sourceOutMs).toBe(8900);
    expect(v1.clips[1]?.transitionIn?.type).toBe('cross_dissolve');
    expect(project.ai?.unusedMediaIds).toContain('media_rec-4');
    expect(project.ai?.decisions.some((row) => row.kind === 'reject_take')).toBe(true);
    expect(project.ai?.decisions.some((row) => /clareza visual/.test(row.reason))).toBe(true);
    const media = project.media.find((item) => item.id === 'media_rec-4');
    expect(media?.takeStatus).toBe('rejected');
  });

  it('splits, trims, ripple-deletes and reorders without duplicating source files', () => {
    let project = createEmptyProject();
    project.media = [
      {
        id: 'media_a',
        kind: 'video',
        name: 'take.mp4',
        durationMs: 60_000,
        width: 1920,
        height: 1080,
        fps: 30,
        hasAudio: true,
        takeStatus: 'available',
      },
    ];
    const clip = makeVideoClip({
      mediaId: 'media_a',
      name: 'Take 1',
      sourceInMs: 0,
      sourceOutMs: 10_000,
    });
    project = appendClipToTrack(project, 'track_v1', clip);
    const id = activeSequence(project).tracks.find((track) => track.id === 'track_v1')!.clips[0]!
      .id;
    const split = splitClipAtPlayhead(project, id, 4000);
    expect(split).toBeTruthy();
    const clips = activeSequence(split!).tracks.find((track) => track.id === 'track_v1')!.clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]?.sourceOutMs).toBe(4000);
    expect(clips[1]?.sourceInMs).toBe(4000);
    expect(clips[0]?.mediaId).toBe('media_a');
    expect(clips[1]?.mediaId).toBe('media_a');

    const trimmed = trimClip(split!, clips[1]!.id, 'right', 8000);
    expect(trimmed).toBeTruthy();
    const afterTrim = activeSequence(trimmed!).tracks.find((track) => track.id === 'track_v1')!
      .clips[1]!;
    expect(afterTrim.timelineEndMs).toBe(8000);
    expect(afterTrim.sourceOutMs).toBe(8000);

    const three = appendClipToTrack(
      trimmed!,
      'track_v1',
      makeVideoClip({ mediaId: 'media_a', name: 'Take extra', sourceOutMs: 2000 }),
    );
    const middle = activeSequence(three).tracks.find((track) => track.id === 'track_v1')!.clips[1]!;
    const rippled = deleteClip(three, middle.id, true)!;
    const remaining = activeSequence(rippled).tracks.find(
      (track) => track.id === 'track_v1',
    )!.clips;
    expect(remaining).toHaveLength(2);
    expect(remaining[1]!.timelineStartMs).toBe(remaining[0]!.timelineEndMs);

    const first = remaining[0]!;
    const last = remaining[1]!;
    const moved = moveClip(rippled, first.id, last.timelineEndMs)!;
    const reordered = activeSequence(moved).tracks.find((track) => track.id === 'track_v1')!.clips;
    expect(reordered[0]!.name).toBe(last.name);
    expect(reordered[1]!.name).toBe(first.name);
  });

  it('undo and redo restore clip order through a history stack', () => {
    let project = createEmptyProject();
    project.media = [
      {
        id: 'm',
        kind: 'video',
        name: 'a',
        durationMs: 5000,
        width: 1080,
        height: 1920,
        fps: 30,
        hasAudio: true,
        takeStatus: 'available',
      },
    ];
    let history = createHistory();
    const before = project;
    project = appendClipToTrack(
      project,
      'track_v1',
      makeVideoClip({ mediaId: 'm', sourceOutMs: 3000 }),
    );
    history = pushHistory(history, before);
    const undone = undoProject(project, history);
    expect(undone).toBeTruthy();
    expect(
      activeSequence(undone!.project).tracks.find((track) => track.id === 'track_v1')!.clips,
    ).toHaveLength(0);
    const redone = redoProject(undone!.project, undone!.history);
    expect(
      activeSequence(redone!.project).tracks.find((track) => track.id === 'track_v1')!.clips,
    ).toHaveLength(1);
  });

  it('detaches audio, mutes original, and compiles a deterministic render graph', () => {
    let project = projectFromDecision({ decision: sampleDecision(), takes });
    const v1 = activeSequence(project).tracks.find((track) => track.id === 'track_v1')!;
    const detached = detachAudio(project, v1.clips[0]!.id)!;
    const video = activeSequence(detached).tracks.find((track) => track.id === 'track_v1')!
      .clips[0]!;
    const audio = activeSequence(detached).tracks.find((track) => track.id === 'track_a1')!.clips;
    expect(video.muted).toBe(true);
    expect(audio.length).toBeGreaterThan(0);
    const withVolume = setClipVolume(detached, audio[0]!.id, 0.4)!;
    const withFx = setTransitionIn(withVolume, v1.clips[1]!.id, 'flash', 280)!;
    const graph = compileVideoProject(withFx);
    expect(graph.scenes).toHaveLength(3);
    expect(graph.scenes[0]?.sourceStartSeconds).toBe(1);
    expect(graph.scenes[1]?.transitionType).toBeDefined();
    expect(compileErrorMessage(graph)).toBeNull();
    const duplicated = duplicateClip(withFx, video.id)!;
    expect(
      activeSequence(duplicated).tracks.find((track) => track.id === 'track_v1')!.clips.length,
    ).toBeGreaterThan(v1.clips.length);
  });

  it('keeps locked clips when merging an AI rewrite', () => {
    const current = projectFromDecision({ decision: sampleDecision(), takes });
    const v1 = activeSequence(current).tracks.find((track) => track.id === 'track_v1')!;
    const locked = setClipLocked(current, v1.clips[1]!.id, true);
    const incoming = projectFromDecision({
      decision: {
        ...sampleDecision(),
        scenes: [sampleDecision().scenes[0]!, sampleDecision().scenes[2]!],
      },
      takes,
    });
    const merged = preserveLockedClips(locked, incoming);
    const clips = activeSequence(merged).tracks.find((track) => track.id === 'track_v1')!.clips;
    expect(clips.some((clip) => clip.id === v1.clips[1]!.id && clip.lockedByUser)).toBe(true);
    expect(merged.ai?.decisions.some((row) => row.kind === 'lock_preserve')).toBe(true);
  });

  it('hydrates legacy metadata.scenes into a real timeline', () => {
    const project = projectFromLegacyScenes({
      reelId: '44444444-4444-4444-8444-444444444444',
      program: 'casa',
      scenes: [
        {
          cam: 'C1',
          cameraId: 'cam-1',
          recordingId: 'rec-1',
          offset: 2,
          duration: 3.2,
          desc: 'gancho',
        },
        {
          cam: 'C3',
          cameraId: 'cam-3',
          recordingId: 'rec-3',
          offset: 5.4,
          duration: 3.5,
          desc: 'prato',
          punchIn: true,
        },
      ],
      takes,
    });
    const clips = activeSequence(project).tracks.find((track) => track.id === 'track_v1')!.clips;
    expect(clips[0]?.sourceInMs).toBe(2000);
    expect(clips[0]?.sourceOutMs).toBe(5200);
    expect(sequenceDurationMs(activeSequence(project))).toBeGreaterThan(6000);
    const frame = previewProjectAt(project, 100);
    expect(frame?.outgoing?.clip.id).toBe(clips[0]?.id);
  });

  it('snaps farther toward a labeled downbeat than a nearby unlabeled beat', () => {
    const project = createEmptyProject();
    const sequence = activeSequence(project);
    sequence.markers = [
      { id: 'down', timeMs: 2000, kind: 'beat', label: 'Bar 2' },
      { id: 'weak', timeMs: 2180, kind: 'beat', label: '' },
    ];
    expect(snapTimeMs(project, 2100, 200)).toBe(snapMsToFrame(2000, project.settings.fps));
  });

  it('serializes and round-trips the project json', () => {
    const project = projectFromDecision({ decision: sampleDecision(), takes });
    const json = JSON.parse(JSON.stringify(project));
    const parsed = parseVideoProject(json);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(
        parsed.data.sequences[0]?.tracks.find((track) => track.id === 'track_v1')?.clips,
      ).toHaveLength(3);
    }
  });
});
