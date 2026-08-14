import { describe, expect, it } from 'vitest';
import { adaptVideoEditDecisionV1ToV2 } from '@reelops/shared';
import { decisionFromReelPlan } from './director.js';
import {
  applyResolvedTimeline,
  directorCandidatesFromClips,
  repairDirectorReferences,
  resolveTimeline,
} from './scene-resolver.js';
import type { ClipCandidate } from '../adapters/analyzer.js';
import type { ReelPlan } from './planner.js';

const cam = (position: number, id: string, recordingId: string): ClipCandidate => ({
  cameraId: id,
  recordingId,
  path: `c${position}.mp4`,
  localPath: `c${position}.mp4`,
  position,
  startOffsetSeconds: 4,
  windowDurationSeconds: 20,
  hasAudio: position === 1,
  role: position === 2 ? 'side' : position === 3 ? 'food' : position === 4 ? 'ambience' : 'master',
});

const clips: ClipCandidate[] = [
  cam(1, '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  cam(2, '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  cam(3, '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  cam(4, '44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),
];

const plan: ReelPlan = {
  program: 'casa',
  join: 'cut',
  duration: 12,
  aspect_ratio: '9:16',
  scenes: [
    {
      camera_id: clips[0]!.cameraId,
      recording_id: clips[0]!.recordingId,
      source_recording_path: 'c1.mp4',
      source_start_offset: 4,
      duration: 12,
      speed: 1,
      transition: 'cut',
      reason: 'legacy',
      position: 1,
      hasAudio: true,
      role: 'master',
    },
  ],
  score: 80,
  detailedScores: { food: 70, action: 60, visual: 80, marketing: 70, ambience: 90 },
  reason: 'fixture',
  provider: 'openai',
};

describe('SceneResolver', () => {
  it('builds the render timeline from the AI decision, not the legacy plan', () => {
    const candidates = directorCandidatesFromClips(clips);
    const v1 = decisionFromReelPlan(plan, {
      tenantId: '11111111-1111-1111-1111-111111111111',
      restaurantId: '22222222-2222-2222-2222-222222222222',
      momentId: '33333333-3333-3333-3333-333333333333',
      reelId: '44444444-4444-4444-4444-444444444444',
    });
    const v2 = adaptVideoEditDecisionV1ToV2(v1);
    v2.scenes = [
      {
        ...v2.scenes[0]!,
        cameraId: 'C4',
        recordingId: 'invented',
        cameraPosition: 4,
        cameraRole: 'ambience',
        sourceStartMs: 5000,
        sourceEndMs: 9000,
        sceneRole: 'establishing',
      },
    ];
    const repaired = repairDirectorReferences(v2, candidates);
    expect(repaired.scenes[0]?.cameraId).toBe(clips[3]!.cameraId);
    expect(repaired.scenes[0]?.recordingId).toBe(clips[3]!.recordingId);
    const resolved = resolveTimeline(repaired, candidates, plan);
    const render = applyResolvedTimeline(plan, resolved);
    expect(render.scenes[0]?.camera_id).toBe(clips[3]!.cameraId);
    expect(render.scenes[0]?.position).toBe(4);
    expect(render.scenes[0]?.source_recording_path).toBe('c4.mp4');
    expect(plan.scenes[0]?.camera_id).toBe(clips[0]!.cameraId);
  });

  it('rejects a camera UUID that is not in the candidate set', () => {
    const candidates = directorCandidatesFromClips(clips);
    const v1 = decisionFromReelPlan(plan, {
      tenantId: '11111111-1111-1111-1111-111111111111',
      restaurantId: '22222222-2222-2222-2222-222222222222',
      momentId: '33333333-3333-3333-3333-333333333333',
      reelId: '44444444-4444-4444-4444-444444444444',
    });
    const v2 = adaptVideoEditDecisionV1ToV2(v1);
    v2.scenes[0]!.cameraId = '99999999-9999-4999-8999-999999999999';
    v2.scenes[0]!.recordingId = '99999999-9999-4999-8999-999999999999';
    expect(() => repairDirectorReferences(v2, candidates)).toThrow(/DIRECTOR_INVALID_REFERENCE/);
  });
});
