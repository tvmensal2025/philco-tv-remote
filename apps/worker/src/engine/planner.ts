import type { CameraRole, EditProgram, JoinOverlayName, Playbook } from '@reelops/shared';
import type { ClipCandidate, EditDecision, SceneAnalyzer } from '../adapters/analyzer.js';
import { coverageReport } from './coverage.js';
import { snapTake, type PeakHit } from './peak-snap.js';
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
};

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
    });
  }
}

export function compileProgram(input: {
  clips: ClipCandidate[];
  program: EditProgram;
  peaksByCamera: Map<string, PeakHit[]>;
  analysis?: EditDecision;
  playbook?: Playbook | null;
}): ReelPlan {
  const clips = input.clips.map((clip) => ({
    ...clip,
    role: clip.role ?? cameraRoleOf(clip.position),
  }));
  const roles = new Set(clips.map((clip) => clip.role));
  if (input.program === 'casa' && !roles.has('ambience')) throw skip('ambience');
  if (input.program === 'oficio' && !roles.has('side')) throw skip('side');
  if (input.program === 'assinatura' && !roles.has('food')) throw skip('food');
  if (input.program === 'pulso' && roles.size < 3) throw skip('roles');

  const book = playbookFor(input.program, input.playbook);
  const usedOffsets = new Map<string, number[]>();
  let lastCameraId: string | undefined;
  const scenes: ReelPlanScene[] = [];

  for (const beat of book.beats) {
    const clip = pickClip(
      clips,
      beat,
      lastCameraId,
      input.peaksByCamera,
      usedOffsets,
      book.program,
    );
    if (!clip) continue;
    const windowDuration = clip.windowDurationSeconds ?? book.targetDuration;
    const snapped = snapTake({
      windowStart: clip.startOffsetSeconds,
      windowDuration,
      takeDuration: beat.durationSeconds,
      peaks: beat.preferPeak === false ? [] : (input.peaksByCamera.get(clip.cameraId) ?? []),
      usedOffsets: usedOffsets.get(clip.cameraId),
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
      reason: beat.reason,
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

function pickClip(
  clips: ClipCandidate[],
  beat: PlaybookBeat,
  lastCameraId: string | undefined,
  peaksByCamera: Map<string, PeakHit[]>,
  usedOffsets: Map<string, number[]>,
  program: EditProgram,
) {
  const allowAdjacent = program === 'oficio' || program === 'assinatura';
  const ranked = [...clips].sort((a, b) => {
    const aRole = beat.roles.indexOf(a.role ?? cameraRoleOf(a.position));
    const bRole = beat.roles.indexOf(b.role ?? cameraRoleOf(b.position));
    const aFit = aRole >= 0 ? aRole : 99;
    const bFit = bRole >= 0 ? bRole : 99;
    if (aFit !== bFit) return aFit - bFit;
    if (!allowAdjacent) {
      if (a.cameraId === lastCameraId) return 1;
      if (b.cameraId === lastCameraId) return -1;
    }
    return peakScore(b, peaksByCamera, usedOffsets) - peakScore(a, peaksByCamera, usedOffsets);
  });
  const preferred = ranked.filter((clip) =>
    beat.roles.includes(clip.role ?? cameraRoleOf(clip.position)),
  );
  const pool = (preferred.length ? preferred : ranked).filter(
    (clip) => allowAdjacent || clip.cameraId !== lastCameraId,
  );
  return pool[0] ?? (!allowAdjacent ? ranked[0] : undefined);
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
