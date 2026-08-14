import { describe, expect, it } from 'vitest';
import { cloneValidatedSpec } from './program-preset.js';
import {
  beatScale,
  buildProgramTimeline,
  clipAtTime,
  diffProgramSpecs,
  formatTimecode,
  joinOverlayHits,
  previewAtTime,
  programCapacity,
  splitSpecAtPlayhead,
} from './program-timeline.js';

describe('program timeline editor', () => {
  it('builds Pulso as eight hard cuts totaling about 16s with overlap', () => {
    const { clips, duration } = buildProgramTimeline(cloneValidatedSpec('pulso'));
    expect(clips).toHaveLength(8);
    expect(duration).toBeGreaterThan(14);
    expect(duration).toBeLessThan(16);
    expect(clips[1]?.joinOverlap).toBeCloseTo(0.04);
  });

  it('splits a take at the playhead when both sides stay renderable', () => {
    const spec = cloneValidatedSpec('pulso');
    const split = splitSpecAtPlayhead(spec, 0.95);
    expect(split?.beats).toHaveLength(9);
    expect(split?.beats[0]?.durationSeconds).toBeCloseTo(0.95);
    expect(split?.beats[1]?.join).toBe('cut');
    expect(splitSpecAtPlayhead(spec, 0.2)).toBeNull();
  });

  it('finds the clip under the playhead', () => {
    const { clips } = buildProgramTimeline(cloneValidatedSpec('casa'));
    expect(clipAtTime(clips, 0.1)?.beat.name).toBe('gancho');
    expect(formatTimecode(1.9)).toBe('00:01.90');
  });

  it('flags Casa if food takes over the cut', () => {
    const spec = cloneValidatedSpec('casa');
    spec.beats = spec.beats.map((beat) => ({
      ...beat,
      roles: ['food'] as const,
      durationSeconds: 4,
    }));
    const capacity = programCapacity(spec);
    expect(capacity.warnings.some((warning) => /comida/i.test(warning))).toBe(true);
  });

  it('simulates punch zoom and Casa fade-in like the FFmpeg graph', () => {
    const casa = cloneValidatedSpec('casa');
    expect(beatScale(casa.beats[0]!, 0)).toBe(1);
    expect(beatScale(casa.beats[0]!, casa.beats[0]!.durationSeconds)).toBeCloseTo(1.07);
    const start = previewAtTime(casa, 0);
    expect(start?.outgoing.opacity).toBe(0);
    expect(start?.captionVisible).toBe(true);
    const afterFade = previewAtTime(casa, 0.7);
    expect(afterFade?.outgoing.opacity).toBeCloseTo(1);
    expect(afterFade?.joinOverlay).toBeNull();
  });

  it('places a flash overlay on the join, not as a replacement take', () => {
    const spec = cloneValidatedSpec('pulso');
    spec.beats[1] = { ...spec.beats[1]!, joinOverlay: 'flash' };
    const hits = joinOverlayHits(spec);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.name).toBe('flash');
    const frame = previewAtTime(spec, hits[0]!.start + hits[0]!.duration / 2);
    expect(frame?.joinOverlay?.name).toBe('flash');
    expect(frame?.joinOverlay?.opacity).toBeGreaterThan(0.4);
  });

  it('crossfades Casa dissolve without dipping both takes to black', () => {
    const casa = cloneValidatedSpec('casa');
    const { clips } = buildProgramTimeline(casa);
    const incoming = clips[1]!;
    const mid = previewAtTime(casa, incoming.start + incoming.joinOverlap / 2);
    expect(mid?.inOverlap).toBe(true);
    expect(mid?.outgoing.opacity).toBeGreaterThan(0.95);
    expect(mid?.incoming?.opacity).toBeCloseTo(0.5, 1);
    expect(mid?.fadeBlack).toBe(0);
  });
});

describe('program spec diff', () => {
  it('reports take, duration and join changes against the validated preset', () => {
    const from = cloneValidatedSpec('pulso');
    const to = cloneValidatedSpec('pulso');
    to.beats[1] = {
      ...to.beats[1]!,
      join: 'dissolve',
      joinDurationSeconds: 0.58,
      durationSeconds: 2.4,
    };
    to.beats[1]!.joinOverlay = 'flash';
    to.targetDuration = 18;
    const lines = diffProgramSpecs(from, to).map((line) => line.label);
    expect(lines.some((line) => /Alvo/.test(line))).toBe(true);
    expect(lines.some((line) => /Take 2/.test(line) && /Dissolve/.test(line))).toBe(true);
    expect(lines.some((line) => /Flash/.test(line))).toBe(true);
    expect(diffProgramSpecs(from, from)).toEqual([]);
  });
});
