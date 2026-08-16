import type { CameraRole, EditProgram, JoinOverlayName, Playbook } from '@reelops/shared';
import type { ClipCandidate, EditDecision, SceneAnalyzer } from '../adapters/analyzer.js';
import { coverageReport } from './coverage.js';
import {
  HIGH_QUALITY_CAMERA_SCORE,
  clusterPreferredStart,
  snapTake,
  spreadPreferredStart,
  type PeakHit,
} from './peak-snap.js';
import { temporalCandidatesFromPeaks, pairAssembly, pairKind } from './temporal-candidates.js';
import { cameraRoleOf, playbookFor, type PlaybookBeat } from './playbook.js';
import type { StyleName } from './rhythm.js';
import { EDITORIAL } from './editorial-thresholds.js';
import { joinedDuration, type MotionName } from '../pipeline/finish.js';

export type ReelPlanScene = {
  camera_id: string;
  recording_id?: string;
  source_recording_path: string;
  source_start_offset: number;
  duration: number;
  speed: number;
  transition: string;
  joinDuration?: number;
  joinOverlay?: JoinOverlayName;
  reason: string;
  position: number;
  hasAudio: boolean;
  role: CameraRole;
  fadeIn?: boolean;
  fadeOut?: boolean;
  punchIn?: boolean;
  motion?: MotionName;
  crop?: [number, number, number, number];
  cropMode?: 'crop' | 'pad_blur';
  cropTight?: boolean;
  cropFilter?: string;
  shotStyle?: string;
  reframe?: { strategy: string; trackId: number | null; qc?: unknown };
  fxAssetId?: string;
  fxMode?: 'none' | 'auto';
};

export type ReelPlan = {
  program: EditProgram;
  join: 'cut' | 'dissolve';
  duration: number;
  aspect_ratio: '9:16';
  scenes: ReelPlanScene[];
  audio?: {
    source_recording_path: string;
    source_start_offset: number;
    duration: number;
  };
  caption?: string;
  hashtags?: string[];
  score: number;
  detailedScores: EditDecision['detailedScores'];
  reason: string;
  provider: EditDecision['provider'];
  model?: string;
  peopleScore?: number;
  storyScore?: number;
  confidence?: number;
  privacyRisk?: string;
  recommendedUse?: string;
  cameraRankings?: EditDecision['cameraRankings'];
  bestFrames?: EditDecision['bestFrames'];
  framesAnalyzed?: number;
  captionStrategy?: 'none' | 'full';
  music?: {
    startSeconds: number;
    bpm?: number;
    confidence?: number;
  };
};

export type HouseCutTake = {
  id: string;
  reason: string;
  transition: string;
  cropMode: 'crop' | 'pad_blur' | null;
  camera: string;
  duration: number;
};

/** Casa never dips to black between takes. Punch-in and leak overlays eat the subject. */
export function keepPictureJoins<T extends Pick<ReelPlan, 'program' | 'scenes' | 'join'>>(
  plan: T,
): T {
  if (plan.program !== 'casa') return plan;
  return {
    ...plan,
    join: 'dissolve',
    scenes: plan.scenes.map((scene, index) => ({
      ...scene,
      transition: index === 0 ? scene.transition : 'dissolve',
      joinDuration: index === 0 ? scene.joinDuration : undefined,
      joinOverlay: undefined,
      punchIn: false,
      motion: scene.motion === 'punch' ? 'none' : scene.motion,
      fxAssetId: undefined,
      fxMode: 'none' as const,
    })),
  };
}

export function recomputePlanDuration(plan: ReelPlan): ReelPlan {
  return {
    ...plan,
    duration: joinedDuration(
      plan.scenes.map((scene) => ({
        duration: scene.duration,
        transition: scene.transition,
        joinDuration: scene.joinDuration,
      })),
    ),
  };
}

export function houseCutFromPlan(plan: Pick<ReelPlan, 'scenes'>): HouseCutTake[] {
  return plan.scenes.map((scene, index) => ({
    id: scene.recording_id ?? `${scene.camera_id}-${index + 1}`,
    reason: scene.reason,
    transition: scene.transition,
    cropMode: scene.cropMode ?? null,
    camera: `C${scene.position}`,
    duration: Number(scene.duration.toFixed(2)),
  }));
}

export class ReelPlanner {
  constructor(
    private readonly visionProvider: SceneAnalyzer,
    private readonly config: { targetDuration: number; style: StyleName; program?: EditProgram },
  ) {}

  async plan(
    clips: ClipCandidate[],
    preset?: EditDecision,
    extras?: {
      peaksByCamera?: Map<string, PeakHit[]>;
      program?: EditProgram;
      playbook?: Playbook | null;
      cameraScores?: Map<number, number>;
      editMode?: 'single_camera' | 'dual_camera' | 'multicamera';
      compatiblePositions?: Set<number>;
      hubByCamera?: Map<string, number>;
      hubsByCamera?: Map<string, number[]>;
    },
  ): Promise<ReelPlan> {
    if (!clips.length) throw new Error('NO_CAMERA_SEGMENTS');
    const analysis = preset ?? (await this.visionProvider.analyze(clips));
    return compileProgram({
      clips,
      program: extras?.program ?? this.config.program ?? 'assinatura',
      peaksByCamera: extras?.peaksByCamera ?? new Map(),
      analysis,
      playbook: extras?.playbook,
      cameraScores: extras?.cameraScores,
      editMode: extras?.editMode,
      compatiblePositions: extras?.compatiblePositions,
      hubByCamera: extras?.hubByCamera,
      hubsByCamera: extras?.hubsByCamera,
    });
  }
}

export function compileProgram(input: {
  clips: ClipCandidate[];
  program: EditProgram;
  peaksByCamera: Map<string, PeakHit[]>;
  analysis?: EditDecision;
  playbook?: Playbook | null;
  cameraScores?: Map<number, number>;
  editMode?: 'single_camera' | 'dual_camera' | 'multicamera';
  compatiblePositions?: Set<number>;
  hubByCamera?: Map<string, number>;
  hubsByCamera?: Map<string, number[]>;
}): ReelPlan {
  const clips = input.clips.map((clip) => ({
    ...clip,
    role: clip.role ?? cameraRoleOf(clip.position),
  }));
  const roles = new Set(clips.map((clip) => clip.role));
  if (input.program === 'oficio' && !roles.has('side')) throw skip('side');
  if (input.program === 'assinatura' && !roles.has('food')) throw skip('food');
  if (input.program === 'pulso' && roles.size < 3) throw skip('roles');

  const book = playbookFor(input.program, input.playbook);
  const usedOffsets = new Map<string, number[]>();
  let lastCameraId: string | undefined;
  const scenes: ReelPlanScene[] = [];
  const exploreSingleCamera =
    input.editMode === 'single_camera' &&
    Math.max(
      0,
      ...(input.cameraScores?.values() ?? []),
      ...(input.analysis?.cameraRankings?.map((row) => row.score) ?? []),
    ) >= HIGH_QUALITY_CAMERA_SCORE;

  const casaHubs = [
    ...new Set(
      [...(input.hubsByCamera?.values() ?? [])].flat().filter((hub) => Number.isFinite(hub)),
    ),
  ];
  const beats = book.beats;

  for (const [beatIndex, beat] of beats.entries()) {
    const clip = pickClip(
      clips,
      beat,
      lastCameraId,
      input.peaksByCamera,
      usedOffsets,
      book.program,
      input.cameraScores,
      input.editMode,
      input.compatiblePositions,
    );
    if (!clip) continue;
    const windowDuration = clip.windowDurationSeconds ?? book.targetDuration;
    const peaks = beat.preferPeak === false ? [] : (input.peaksByCamera.get(clip.cameraId) ?? []);
    const forcedHub = input.hubByCamera?.get(clip.cameraId);
    const scoutedHubs =
      input.hubsByCamera?.get(clip.cameraId)?.filter((hub) => Number.isFinite(hub)) ??
      (forcedHub != null ? [forcedHub] : []);
    const hubSchedule = scoutedHubs.length ? casaHubSchedule(scoutedHubs, beats.length) : [];
    const hubForBeat = hubSchedule[beatIndex] ?? forcedHub;
    const countOnHub = hubSchedule.filter((hub) => hub === hubForBeat).length || beats.length;
    const indexOnHub = Math.max(
      0,
      hubSchedule.slice(0, beatIndex + 1).filter((hub) => hub === hubForBeat).length - 1,
    );
    const takeDuration = beat.durationSeconds;
    const casaPreferred = clusterPreferredStart({
      windowStart: clip.startOffsetSeconds,
      windowDuration,
      takeDuration,
      index: indexOnHub,
      count: countOnHub,
      peaks,
      hub: hubForBeat,
      minGap: casaHubs.length ? EDITORIAL.minTakeGapSeconds : undefined,
    });
    const hookCandidate =
      book.program === 'casa' && beatIndex === 0
        ? temporalCandidatesFromPeaks({
            cameraId: clip.cameraId,
            windowStart: clip.startOffsetSeconds,
            windowDuration,
            peaks,
            takeDuration,
            hub: forcedHub,
          }).sort((left, right) => right.fusedScore - left.fusedScore)[0]
        : undefined;
    const snapped = snapTake({
      windowStart: clip.startOffsetSeconds,
      windowDuration,
      takeDuration,
      peaks,
      usedOffsets: usedOffsets.get(clip.cameraId),
      minStartGap: casaHubs.length ? EDITORIAL.minTakeGapSeconds : undefined,
      preferredStart:
        book.program === 'casa'
          ? (hookCandidate?.start ?? casaPreferred)
          : exploreSingleCamera
            ? spreadPreferredStart({
                windowStart: clip.startOffsetSeconds,
                windowDuration,
                takeDuration,
                index: beatIndex,
                count: beats.length,
              })
            : undefined,
    });
    if (book.program === 'casa' && casaHubs.length && scenes.length) {
      const previous = scenes.at(-1)!;
      const farJumpsUsed = scenes.filter(
        (scene, index) =>
          index > 0 && pairKind(candidateOf(scenes[index - 1]!), candidateOf(scene)) === 'act_cut',
      ).length;
      const pair = pairAssembly(
        candidateOf(previous),
        candidateOf({ ...previous, camera_id: clip.cameraId, source_start_offset: snapped.start }),
        farJumpsUsed,
      );
      if (!pair.ok) continue;
    }
    usedOffsets.set(clip.cameraId, [...(usedOffsets.get(clip.cameraId) ?? []), snapped.start]);
    lastCameraId = clip.cameraId;
    scenes.push({
      camera_id: clip.cameraId,
      recording_id: clip.recordingId,
      source_recording_path: clip.localPath,
      source_start_offset: snapped.start,
      duration: snapped.duration,
      speed: 1,
      transition: beat.join,
      joinDuration: beat.joinDurationSeconds,
      joinOverlay: beat.joinOverlay,
      reason: `${beat.reason} · C${clip.position} score=${Math.round(quality(clip, beat, input.cameraScores))}`,
      position: clip.position,
      hasAudio: clip.hasAudio,
      role: clip.role ?? 'master',
      fadeIn: beat.fadeIn,
      fadeOut: beat.fadeOut,
      punchIn: beat.punchIn,
      motion: beat.motion ?? (beat.punchIn ? 'punch' : clip.role === 'ambience' ? 'drift' : 'none'),
      fxAssetId: beat.fxAssetId,
      fxMode: beat.fxMode,
    });
  }

  const report = coverageReport(
    book,
    scenes.map((scene) => ({
      role: scene.role,
      duration: scene.duration,
      cameraId: scene.camera_id,
    })),
  );
  if (!report.ok) throw new Error(`SKIP_PROGRAM:${report.reason}`);

  const duration = joinedDuration(
    scenes.map((scene) => ({
      duration: scene.duration,
      transition: scene.transition,
      joinDuration: scene.joinDuration,
    })),
  );
  const master =
    clips.find((clip) => clip.hasAudio && clip.role === 'master') ??
    clips.find((clip) => clip.hasAudio && clip.position === 1) ??
    clips.find((clip) => clip.hasAudio);
  const analysis = input.analysis;

  return {
    program: book.program,
    join: book.join,
    duration,
    aspect_ratio: '9:16',
    scenes,
    audio: master
      ? {
          source_recording_path: master.localPath,
          source_start_offset: master.startOffsetSeconds,
          duration,
        }
      : undefined,
    caption: analysis?.captionPt,
    hashtags: analysis?.hashtags,
    score: analysis?.score ?? 70,
    detailedScores: analysis?.detailedScores ?? {
      food: 0,
      action: 0,
      visual: 0,
      marketing: 0,
      ambience: 0,
    },
    reason: analysis?.reason ?? `Programa ${book.program}`,
    provider: analysis?.provider ?? 'heuristic',
    model: analysis?.model,
    peopleScore: analysis?.peopleScore,
    storyScore: analysis?.storyScore,
    confidence: analysis?.confidence,
    privacyRisk: analysis?.privacyRisk,
    recommendedUse: analysis?.recommendedUse,
    cameraRankings: analysis?.cameraRankings,
    bestFrames: analysis?.bestFrames,
    framesAnalyzed: analysis?.framesAnalyzed,
    captionStrategy: book.program === 'casa' ? 'none' : book.captions?.strategy,
  };
}

function skip(role: string): Error {
  return new Error(`SKIP_PROGRAM:MISSING_ROLE:${role}`);
}

function casaHubSchedule(hubs: number[], beatCount: number) {
  if (!hubs.length) return [];
  if (hubs.length === 1) return Array.from({ length: beatCount }, () => hubs[0]!);
  const base = Math.floor(beatCount / hubs.length);
  const extra = beatCount % hubs.length;
  const schedule: number[] = [];
  for (let index = 0; index < hubs.length; index += 1) {
    const count = base + (index < extra ? 1 : 0);
    for (let take = 0; take < count; take += 1) schedule.push(hubs[index]!);
  }
  return schedule;
}

function candidateOf(scene: Pick<ReelPlanScene, 'camera_id' | 'source_start_offset' | 'duration'>) {
  return {
    cameraId: scene.camera_id,
    start: scene.source_start_offset,
    end: scene.source_start_offset + scene.duration,
    peak: scene.source_start_offset,
    fusedScore: 0,
    usable: true,
  };
}

function quality(clip: ClipCandidate, beat: PlaybookBeat, cameraScores?: Map<number, number>) {
  const index = beat.roles.indexOf(clip.role ?? cameraRoleOf(clip.position));
  const roleBonus = index >= 0 ? 6 - Math.min(5, index) : 0;
  return cameraScores?.get(clip.position) ?? 50 + roleBonus;
}

function pickClip(
  clips: ClipCandidate[],
  beat: PlaybookBeat,
  lastCameraId: string | undefined,
  peaksByCamera: Map<string, PeakHit[]>,
  usedOffsets: Map<string, number[]>,
  program: EditProgram,
  cameraScores?: Map<number, number>,
  editMode?: 'single_camera' | 'dual_camera' | 'multicamera',
  compatiblePositions?: Set<number>,
) {
  const pool = clips.filter(
    (clip) => !compatiblePositions || compatiblePositions.has(clip.position),
  );
  if (!pool.length) return undefined;
  const scored = pool.map((clip) => quality(clip, beat, cameraScores));
  const best = Math.max(...scored);
  const second = [...scored].sort((a, b) => b - a)[1] ?? 0;
  const dominant = best - second >= 12 || editMode === 'single_camera';
  const allowAdjacent = program === 'oficio' || program === 'assinatura' || dominant;
  const ranked = [...pool].sort((a, b) => {
    const qa = quality(a, beat, cameraScores);
    const qb = quality(b, beat, cameraScores);
    if (Math.abs(qa - qb) >= 6) return qb - qa;
    const aFit = beat.roles.indexOf(a.role ?? cameraRoleOf(a.position));
    const bFit = beat.roles.indexOf(b.role ?? cameraRoleOf(b.position));
    const aRole = aFit >= 0 ? aFit : 99;
    const bRole = bFit >= 0 ? bFit : 99;
    if (aRole !== bRole && Math.abs(qa - qb) < 6) return aRole - bRole;
    if (!allowAdjacent) {
      if (a.cameraId === lastCameraId) return 1;
      if (b.cameraId === lastCameraId) return -1;
    }
    return peakScore(b, peaksByCamera, usedOffsets) - peakScore(a, peaksByCamera, usedOffsets);
  });
  const next = ranked.filter((clip) => allowAdjacent || clip.cameraId !== lastCameraId);
  return next[0] ?? ranked[0];
}

function peakScore(
  clip: ClipCandidate,
  peaksByCamera: Map<string, PeakHit[]>,
  usedOffsets: Map<string, number[]>,
) {
  const used = new Set(
    (usedOffsets.get(clip.cameraId) ?? []).map((value) => Number(value.toFixed(2))),
  );
  const unused = (peaksByCamera.get(clip.cameraId) ?? []).filter(
    (peak) => !used.has(Number(peak.offsetSeconds.toFixed(2))),
  );
  return unused[0]?.fusedScore ?? 0;
}
