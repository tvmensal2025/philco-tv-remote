import type { CameraRole, EditProgram, JoinOverlayName, Playbook } from '@reelops/shared';
import type { ClipCandidate, EditDecision, SceneAnalyzer } from '../adapters/analyzer.js';
import { coverageReport } from './coverage.js';
import {
  HIGH_QUALITY_CAMERA_SCORE,
  snapTake,
  spreadPreferredStart,
  type PeakHit,
} from './peak-snap.js';
import { cameraRoleOf, playbookFor, type PlaybookBeat } from './playbook.js';
import type { StyleName } from './rhythm.js';
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

  for (const [beatIndex, beat] of book.beats.entries()) {
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
    const snapped = snapTake({
      windowStart: clip.startOffsetSeconds,
      windowDuration,
      takeDuration: beat.durationSeconds,
      peaks: beat.preferPeak === false ? [] : (input.peaksByCamera.get(clip.cameraId) ?? []),
      usedOffsets: usedOffsets.get(clip.cameraId),
      preferredStart: exploreSingleCamera
        ? spreadPreferredStart({
            windowStart: clip.startOffsetSeconds,
            windowDuration,
            takeDuration: beat.durationSeconds,
            index: beatIndex,
            count: book.beats.length,
          })
        : undefined,
    });
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
    captionStrategy: book.captions?.strategy,
  };
}

function skip(role: string): Error {
  return new Error(`SKIP_PROGRAM:MISSING_ROLE:${role}`);
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
