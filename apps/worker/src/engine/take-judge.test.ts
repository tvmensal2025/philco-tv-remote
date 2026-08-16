import { describe, expect, it } from 'vitest';
import { nextClusterOffset } from './peak-snap.js';
import {
  actionFromVerdict,
  judgeFinishedMp4,
  judgeTakeImages,
  pickScoutedHub,
  refinePlanTakes,
  takeVerdictSchema,
  type TakeVerdict,
} from './take-judge.js';
import type { ReelPlan } from './planner.js';

const diningRoom: TakeVerdict = {
  action: 'replace',
  subjectInFrame: false,
  sameScene: false,
  blackFrame: false,
  publishable: false,
  reason: 'mesas de clientes, nao palco',
};

function casaPlan(offset = 12): ReelPlan {
  return {
    program: 'casa',
    join: 'dissolve',
    duration: 12,
    aspect_ratio: '9:16',
    scenes: [
      {
        camera_id: 'cam-1',
        source_recording_path: 'c1.mp4',
        source_start_offset: offset,
        duration: 12,
        speed: 1,
        transition: 'dissolve',
        reason: 'gancho',
        position: 1,
        hasAudio: true,
        role: 'master',
      },
    ],
    score: 80,
    detailedScores: { food: 40, action: 70, visual: 80, marketing: 50, ambience: 40 },
    reason: 'test',
    provider: 'openai',
  };
}

describe('take judge', () => {
  it('refuses a dining-room JPEG for Casa and fails after two replacements', () => {
    const verdict = takeVerdictSchema.parse(diningRoom);
    expect(verdict.publishable).toBe(false);
    expect(actionFromVerdict(verdict, 0)).toBe('replace');
    expect(actionFromVerdict(verdict, 2)).toBe('fail');
  });

  it('keeps a stage take that would be posted', () => {
    expect(
      actionFromVerdict(
        {
          action: 'keep',
          subjectInFrame: true,
          sameScene: true,
          blackFrame: false,
          publishable: true,
          reason: 'cantora no palco',
        },
        0,
      ),
    ).toBe('keep');
  });

  it('rejects a pretty dining table even when visualQuality is high', () => {
    expect(
      actionFromVerdict(
        {
          action: 'keep',
          subjectInFrame: false,
          sameScene: false,
          blackFrame: false,
          publishable: true,
          visualQuality: 94,
          contentRelevance: 18,
          hardReject: false,
          rejectCode: 'wrong_scene',
          reason: 'mesa bonita, cena errada',
        },
        0,
      ),
    ).toBe('replace');
  });

  it('hard-rejects black immediately and never treats it as replace', () => {
    expect(
      actionFromVerdict(
        {
          action: 'replace',
          subjectInFrame: false,
          sameScene: true,
          blackFrame: true,
          publishable: false,
          reason: 'preto',
        },
        0,
      ),
    ).toBe('fail');
  });

  it('asks the VLM to reject a dining-room take', async () => {
    const verdict = await judgeTakeImages({
      program: 'casa',
      images: [Buffer.from('mesa')],
      takeIndex: 1,
      takeCount: 5,
      firstTakeHint: 'cantora no palco',
      ask: async () => diningRoom,
    });
    expect(verdict.subjectInFrame).toBe(false);
    expect(verdict.sameScene).toBe(false);
    expect(actionFromVerdict(verdict, 0)).toBe('replace');
  });

  it('replaces a rejected take with another offset on the same peak, not the far window', async () => {
    const next = await refinePlanTakes({
      plan: casaPlan(12),
      peaksByCamera: new Map([
        [
          'cam-1',
          [
            { offsetSeconds: 14, fusedScore: 90 },
            { offsetSeconds: 18, fusedScore: 80 },
            { offsetSeconds: 200, fusedScore: 99 },
          ],
        ],
      ]),
      windows: new Map([['cam-1', { start: 0, duration: 240 }]]),
      dir: '/tmp',
      extractFrame: async () => undefined,
      readJpeg: async () => Buffer.from('jpg'),
      ask: async () => {
        return diningRoom;
      },
    }).catch((error: unknown) => error);
    expect(next).toBeInstanceOf(Error);
    expect(String(next)).toMatch(/TAKE_JUDGE_FAILED/);
  });

  it('keeps a take after the dining-room offset is swapped for the stage peak', async () => {
    let calls = 0;
    const plan = await refinePlanTakes({
      plan: casaPlan(12),
      peaksByCamera: new Map([
        [
          'cam-1',
          [
            { offsetSeconds: 14, fusedScore: 90 },
            { offsetSeconds: 19, fusedScore: 88 },
          ],
        ],
      ]),
      windows: new Map([['cam-1', { start: 0, duration: 240 }]]),
      dir: '/tmp',
      extractFrame: async () => undefined,
      readJpeg: async () => Buffer.from('jpg'),
      ask: async () => {
        calls += 1;
        if (calls === 1) return diningRoom;
        return {
          action: 'keep',
          subjectInFrame: true,
          sameScene: true,
          blackFrame: false,
          publishable: true,
          reason: 'cantora no palco',
        };
      },
    });
    expect(calls).toBe(2);
    expect(plan.plan.scenes[0]?.source_start_offset).not.toBe(12);
    expect(plan.plan.scenes[0]?.source_start_offset ?? 0).toBeLessThan(50);
    expect(plan.reports.some((row) => row.decision === 'CONDITIONAL')).toBe(true);
    expect(plan.reports.some((row) => row.decision === 'ACCEPT')).toBe(true);
  });

  it('fails the finished MP4 when the judge would not publish', async () => {
    await expect(
      judgeFinishedMp4({
        program: 'casa',
        mp4: 'reel.mp4',
        durationSeconds: 50,
        dir: '/tmp',
        extractFrame: async () => undefined,
        readJpeg: async () => Buffer.from('jpg'),
        ask: async () => ({ publishable: false, reason: 'mesas no meio do filme' }),
      }),
    ).rejects.toThrow(/TAKE_JUDGE_FAILED/);
  });

  it('stays on the same peak when asking for a replacement offset', () => {
    const next = nextClusterOffset({
      windowStart: 0,
      windowDuration: 240,
      takeDuration: 12,
      usedOffsets: [12],
      peaks: [
        { offsetSeconds: 18, fusedScore: 80 },
        { offsetSeconds: 210, fusedScore: 99 },
      ],
      hub: 14,
    });
    expect(next).not.toBeNull();
    expect(next ?? 0).toBeLessThan(70);
    expect(next ?? 0).not.toBe(210);
  });

  it('picks the relevant stage hub over a prettier dining-room hub', () => {
    const chosen = pickScoutedHub([
      {
        cameraId: 'cam-1',
        hub: 210,
        visualQuality: 94,
        contentRelevance: 18,
        subjectInFrame: false,
        hardReject: false,
        reason: 'mesas',
      },
      {
        cameraId: 'cam-1',
        hub: 18,
        visualQuality: 71,
        contentRelevance: 88,
        subjectInFrame: true,
        hardReject: false,
        reason: 'cantora',
      },
    ]);
    expect(chosen?.hub).toBe(18);
  });
});
