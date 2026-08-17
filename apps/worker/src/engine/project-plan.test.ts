import { describe, expect, it } from 'vitest';
import { compileVideoProject, projectFromLegacyScenes } from '@reelops/shared';
import { applyCompiledGraph } from './project-plan.js';
import type { ReelPlan } from './planner.js';

describe('applyCompiledGraph', () => {
  it('maps editor clips onto recording local paths', () => {
    const project = projectFromLegacyScenes({
      reelId: '44444444-4444-4444-8444-444444444444',
      scenes: [
        {
          cam: 'C1',
          cameraId: 'cam-1',
          recordingId: 'rec-1',
          offset: 1,
          duration: 2,
          desc: 'hook',
        },
      ],
      takes: [{ recordingId: 'rec-1', cameraId: 'cam-1', cameraPosition: 1, durationMs: 20_000 }],
    });
    const graph = compileVideoProject(project);
    const plan = {
      program: 'casa',
      join: 'cut',
      duration: 12,
      aspect_ratio: '9:16',
      scenes: [],
      score: 70,
      detailedScores: { food: 0, action: 0, visual: 0, marketing: 0, ambience: 0 },
      reason: 'test',
      provider: 'heuristic',
    } as unknown as ReelPlan;
    const next = applyCompiledGraph(plan, graph, [
      {
        cameraId: 'cam-1',
        recordingId: 'rec-1',
        path: 'raw/a.mp4',
        localPath: '/tmp/a.mp4',
        position: 1,
        startOffsetSeconds: 0,
        hasAudio: true,
        role: 'master',
      },
    ]);
    expect(next.scenes[0]?.source_recording_path).toBe('/tmp/a.mp4');
    expect(next.scenes[0]?.source_start_offset).toBe(1);
    expect(next.scenes[0]?.duration).toBe(2);
    expect(next.scenes[0]?.cropMode).toBe('crop');
    expect(next.scenes[0]?.crop?.[2]).toBeGreaterThan(400);
  });
});
