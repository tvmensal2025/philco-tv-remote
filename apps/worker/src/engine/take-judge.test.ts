import { describe, expect, it } from 'vitest';
import { nextClusterOffset } from './peak-snap.js';
import {
  actionFromVerdict,
  customersOnlyFromVerdict,
  judgeFinishedMp4,
  judgeTakeImages,
  pickScoutedHub,
  refinePlanTakes,
  scoutClusterHubs,
  takeVerdictSchema,
  trimKeptDuration,
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

function casaPlan(offsets: number | number[] = 12): ReelPlan {
  const starts = Array.isArray(offsets) ? offsets : [offsets];
  return {
    program: 'casa',
    join: 'dissolve',
    duration: starts.length * 12,
    aspect_ratio: '9:16',
    scenes: starts.map((offset, index) => ({
      camera_id: 'cam-1',
      source_recording_path: 'c1.mp4',
      source_start_offset: offset,
      duration: 12,
      speed: 1,
      transition: 'dissolve',
      reason: index === 0 ? 'gancho' : 'take',
      position: 1,
      hasAudio: true,
      role: 'master',
    })),
    score: 80,
    detailedScores: { food: 40, action: 70, visual: 80, marketing: 50, ambience: 40 },
    reason: 'test',
    provider: 'openai',
  };
}

describe('take judge', () => {
  it('treats a well-lit customer room as customersOnly even without the flag', () => {
    expect(
      customersOnlyFromVerdict({
        action: 'keep',
        subjectInFrame: true,
        sameScene: true,
        blackFrame: false,
        publishable: true,
        visualQuality: 80,
        contentRelevance: 80,
        reason: 'Clear, well-lit restaurant scene with customers, matching program subject',
      }),
    ).toBe(true);
    expect(
      customersOnlyFromVerdict({
        action: 'fail',
        subjectInFrame: false,
        sameScene: true,
        blackFrame: false,
        publishable: false,
        reason: 'No performer or stage visible, only seated customers in dining area',
      }),
    ).toBe(true);
    expect(
      customersOnlyFromVerdict({
        action: 'keep',
        subjectInFrame: true,
        sameScene: true,
        blackFrame: false,
        publishable: true,
        reason: 'Clear stage view with performer, good lighting',
      }),
    ).toBe(false);
  });
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

it('rejects a dining-room hub even if the model scored it as relevant', () => {
  expect(
    actionFromVerdict(
      {
        action: 'keep',
        subjectInFrame: true,
        sameScene: true,
        blackFrame: false,
        publishable: true,
        visualQuality: 80,
        contentRelevance: 80,
        customersOnly: true,
        reason: 'clientes na sala',
      },
      0,
    ),
  ).toBe('replace');
  expect(
    pickScoutedHub([
      {
        cameraId: 'cam-1',
        hub: 662,
        visualQuality: 80,
        contentRelevance: 80,
        subjectInFrame: true,
        customersOnly: true,
        hardReject: false,
        reason: 'clientes',
      },
      {
        cameraId: 'cam-1',
        hub: 600,
        visualQuality: 80,
        contentRelevance: 80,
        subjectInFrame: true,
        customersOnly: false,
        hardReject: false,
        reason: 'palco',
      },
    ])?.hub,
  ).toBe(600);
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

it('does not abort the reel when the model hardRejects a dining-room take', () => {
  expect(
    actionFromVerdict(
      {
        action: 'fail',
        subjectInFrame: false,
        sameScene: true,
        blackFrame: false,
        publishable: false,
        visualQuality: 70,
        contentRelevance: 10,
        hardReject: true,
        rejectCode: 'wrong_scene',
        reason: 'No performer or stage visible, only seated customers in dining area',
      },
      0,
    ),
  ).toBe('replace');
});

it('keeps the approved hook and drops later dining takes instead of failing the job', async () => {
  const stage = {
    action: 'keep' as const,
    subjectInFrame: true,
    sameScene: true,
    blackFrame: false,
    publishable: true,
    reason: 'Performer visible on stage with audience',
  };
  let calls = 0;
  const judged = await refinePlanTakes({
    plan: casaPlan([600, 605.4]),
    peaksByCamera: new Map([
      [
        'cam-1',
        [
          { offsetSeconds: 600.3, fusedScore: 90 },
          { offsetSeconds: 605, fusedScore: 70 },
          { offsetSeconds: 792.6, fusedScore: 88 },
        ],
      ],
    ]),
    windows: new Map([['cam-1', { start: 580, duration: 240 }]]),
    dir: '/tmp',
    extractFrame: async () => undefined,
    readJpeg: async () => Buffer.from('jpg'),
    hubByCamera: new Map([['cam-1', 600.3]]),
    hubsByCamera: new Map([['cam-1', [600.3, 792.6]]]),
    ask: async () => {
      calls += 1;
      if (calls === 1) return stage;
      return diningRoom;
    },
  });
  expect(judged.plan.scenes.length).toBeGreaterThanOrEqual(1);
  expect(judged.plan.scenes[0]?.source_start_offset).toBe(600);
  expect(
    judged.plan.scenes.every(
      (scene) => scene.source_start_offset < 650 || scene.source_start_offset > 750,
    ),
  ).toBe(true);
});

it('trims a kept Casa take to the usable stage window instead of padding 12s', () => {
  expect(trimKeptDuration(12, 1, 'casa')).toBeLessThanOrEqual(8.5);
  expect(trimKeptDuration(12, 0.5, 'casa')).toBe(6);
  expect(trimKeptDuration(12, 1, 'oficio')).toBe(12);
});

it('keeps the hook shorter than a dining tail when the VLM marks usableUntil', async () => {
  const judged = await refinePlanTakes({
    plan: casaPlan(600),
    peaksByCamera: new Map([['cam-1', [{ offsetSeconds: 600.3, fusedScore: 90 }]]]),
    windows: new Map([['cam-1', { start: 580, duration: 240 }]]),
    dir: '/tmp',
    extractFrame: async () => undefined,
    readJpeg: async () => Buffer.from('jpg'),
    ask: async () => ({
      action: 'keep',
      subjectInFrame: true,
      sameScene: true,
      blackFrame: false,
      publishable: true,
      visualQuality: 80,
      contentRelevance: 80,
      usableUntil: 0.5,
      reason: 'Performer visible on stage with audience',
    }),
  });
  expect(judged.plan.scenes[0]?.duration).toBe(6);
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

it('does not veto a finished MP4 whose kept takes are already approved stage', async () => {
  const verdict = await judgeFinishedMp4({
    program: 'casa',
    mp4: 'reel.mp4',
    durationSeconds: 12,
    dir: '/tmp',
    extractFrame: async () => undefined,
    readJpeg: async () => Buffer.from('jpg'),
    ask: async () => ({
      publishable: false,
      wrongScene: true,
      reason: 'Most frames show customers dining, not the live show or performer clearly.',
    }),
    approvedTakes: [
      {
        takeIndex: 0,
        cameraId: 'cam-1',
        sourceIn: 600,
        sourceOut: 612,
        frames: [602, 606, 610],
        visualQuality: 80,
        contentRelevance: 80,
        subjectInFrame: true,
        sameScene: true,
        hardReject: false,
        rejectCode: 'none',
        decision: 'ACCEPT',
        action: 'keep',
        replacements: 0,
        reason: 'Performer visible on stage',
        customersOnly: false,
      },
    ],
  });
  expect(verdict.publishable).toBe(true);
});

it('keeps a stage hub even when the model sets customersOnly', async () => {
  const reports = await scoutClusterHubs({
    program: 'casa',
    cameraId: 'cam-1',
    sourcePath: 'c1.mp4',
    hubs: [792.6],
    dir: '/tmp',
    extractFrame: async () => undefined,
    readJpeg: async () => Buffer.from('jpg'),
    ask: async () => ({
      action: 'keep',
      subjectInFrame: false,
      sameScene: true,
      blackFrame: false,
      publishable: true,
      visualQuality: 80,
      contentRelevance: 80,
      customersOnly: true,
      reason:
        'Performer with microphone visible, stage and audience present, suitable for live show reel.',
    }),
  });
  expect(reports[0]?.customersOnly).toBe(false);
  expect(reports[0]?.subjectInFrame).toBe(true);
  expect(pickScoutedHub(reports)?.hub).toBe(792.6);
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

it('jumps a replacement to another scouted stage hub instead of walking into dining', () => {
  const next = nextClusterOffset({
    windowStart: 580,
    windowDuration: 240,
    takeDuration: 12,
    usedOffsets: [600, 605.4],
    peaks: [
      { offsetSeconds: 600.3, fusedScore: 90 },
      { offsetSeconds: 605, fusedScore: 70 },
      { offsetSeconds: 662.6, fusedScore: 99 },
      { offsetSeconds: 792.6, fusedScore: 88 },
    ],
    hub: 600.3,
    hubs: [600.3, 792.6],
  });
  expect(next).not.toBeNull();
  expect(next ?? 0).toBeGreaterThan(750);
});

it('picks the relevant stage hub over a prettier dining-room hub', () => {
  const chosen = pickScoutedHub([
    {
      cameraId: 'cam-1',
      hub: 210,
      visualQuality: 94,
      contentRelevance: 18,
      subjectInFrame: false,
      customersOnly: true,
      hardReject: false,
      reason: 'mesas',
    },
    {
      cameraId: 'cam-1',
      hub: 18,
      visualQuality: 71,
      contentRelevance: 88,
      subjectInFrame: true,
      customersOnly: false,
      hardReject: false,
      reason: 'cantora',
    },
  ]);
  expect(chosen?.hub).toBe(18);
});

it('infers a customer-table hub from the reason when customersOnly is omitted', () => {
  expect(
    pickScoutedHub([
      {
        cameraId: 'cam-1',
        hub: 662,
        visualQuality: 80,
        contentRelevance: 80,
        subjectInFrame: true,
        customersOnly: true,
        hardReject: false,
        reason: 'restaurant scene with customers',
      },
      {
        cameraId: 'cam-1',
        hub: 600,
        visualQuality: 80,
        contentRelevance: 80,
        subjectInFrame: true,
        customersOnly: false,
        hardReject: false,
        reason: 'Clear stage view with performer',
      },
    ])?.hub,
  ).toBe(600);
});
