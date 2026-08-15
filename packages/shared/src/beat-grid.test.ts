import { describe, expect, it } from 'vitest';
import {
  alignAnalysisToDownbeat,
  alignAnalysisToHook,
  analyzePcm,
  energyAt,
  musicMarkers,
  musicSectionMarkers,
  nearestBeat,
  pullWindowSeconds,
  sectionAt,
  snapTimeToGrid,
  syntheticClickTrack,
} from './beat-grid.js';

describe('beat grid', () => {
  it('detects 120 BPM clicks and downbeats on bar one', () => {
    const samples = syntheticClickTrack({ bpm: 120, durationSeconds: 12 });
    const analysis = analyzePcm(samples);
    expect(analysis.confidence).toBeGreaterThan(0.2);
    expect(analysis.bpm).toBeGreaterThan(116);
    expect(analysis.bpm).toBeLessThan(124);
    expect(analysis.beats.length).toBeGreaterThan(16);
    const firstDown = analysis.downbeats[0] ?? 99;
    expect(firstDown).toBeLessThan(0.12);
    const secondBar = analysis.downbeats.find((time) => time > 1.5) ?? 0;
    expect(secondBar).toBeGreaterThan(1.85);
    expect(secondBar).toBeLessThan(2.15);
  });

  it('detects 90 BPM without octave error', () => {
    const samples = syntheticClickTrack({ bpm: 90, durationSeconds: 10 });
    const analysis = analyzePcm(samples);
    expect(analysis.bpm).toBeGreaterThan(86);
    expect(analysis.bpm).toBeLessThan(94);
  });

  it('snaps a late cut onto the nearest beat, harder when strength is high', () => {
    const samples = syntheticClickTrack({ bpm: 120, durationSeconds: 8 });
    const analysis = analyzePcm(samples);
    const weak = snapTimeToGrid(1.12, analysis, { snapStrength: 0.12 });
    const strong = snapTimeToGrid(1.12, analysis, { snapStrength: 0.88, preferDownbeat: false });
    expect(Math.abs(strong - 1)).toBeLessThan(Math.abs(weak - 1));
    expect(Math.abs(strong - 1)).toBeLessThan(0.08);
  });

  it('prefers a downbeat when the cut is a pickup into the bar', () => {
    const samples = syntheticClickTrack({ bpm: 120, durationSeconds: 8 });
    const analysis = analyzePcm(samples);
    const beat = nearestBeat(analysis.beats, 1.92, { preferDownbeat: true, maxSeconds: 0.28 });
    expect(beat?.isDownbeat).toBe(true);
    expect(beat?.timeSeconds).toBeGreaterThan(1.85);
    expect(beat?.timeSeconds).toBeLessThan(2.15);
  });

  it('phase-aligns the grid so t=0 is the one', () => {
    const samples = syntheticClickTrack({ bpm: 120, durationSeconds: 8 });
    const raw = analyzePcm(samples);
    const shifted: typeof raw = {
      ...raw,
      beats: raw.beats.map((beat) => ({ ...beat, timeSeconds: beat.timeSeconds + 0.4 })),
      downbeats: raw.downbeats.map((time) => time + 0.4),
    };
    const aligned = alignAnalysisToDownbeat(shifted);
    expect(aligned.offsetSeconds).toBeGreaterThan(0.3);
    expect(aligned.downbeats[0]).toBeLessThan(0.12);
  });

  it('names a quiet opening as intro and emits bar markers', () => {
    const samples = syntheticClickTrack({ bpm: 120, durationSeconds: 8 });
    const analysis = analyzePcm(samples);
    expect(sectionAt(analysis, 0.2)?.kind).toBeTruthy();
    expect(
      Math.max(energyAt(analysis, 0), energyAt(analysis, 0.5), energyAt(analysis, 2)),
    ).toBeGreaterThan(0);
    const markers = musicMarkers(analysis, 4);
    expect(markers.some((row) => row.downbeat && row.label === '1')).toBe(true);
    expect(markers.length).toBeGreaterThan(4);
  });

  it('widens the pull window with snap strength', () => {
    expect(pullWindowSeconds(0.1)).toBeLessThan(pullWindowSeconds(0.9));
    expect(pullWindowSeconds(1)).toBeLessThan(0.3);
  });

  it('aligns to a drop in the first 8s, else to the one', () => {
    const samples = syntheticClickTrack({ bpm: 120, durationSeconds: 8 });
    const raw = analyzePcm(samples);
    const shifted: typeof raw = {
      ...raw,
      beats: raw.beats.map((beat) => ({ ...beat, timeSeconds: beat.timeSeconds + 0.4 })),
      downbeats: raw.downbeats.map((time) => time + 0.4),
      sections: [],
    };
    const toOne = alignAnalysisToHook(shifted);
    expect(toOne.offsetSeconds).toBeGreaterThan(0.3);
    expect(toOne.downbeats[0]).toBeLessThan(0.12);

    const withDrop: typeof raw = {
      ...raw,
      sections: [
        { startSeconds: 0, endSeconds: 2, kind: 'intro', energy: 0.2 },
        { startSeconds: 2, endSeconds: 6, kind: 'drop', energy: 0.9 },
      ],
    };
    const toDrop = alignAnalysisToHook(withDrop);
    expect(toDrop.offsetSeconds).toBeGreaterThan(1.7);
    expect(toDrop.offsetSeconds).toBeLessThan(2.2);
  });

  it('emits labeled section markers and skips groove', () => {
    const samples = syntheticClickTrack({ bpm: 120, durationSeconds: 8 });
    const analysis = analyzePcm(samples);
    const withSections: typeof analysis = {
      ...analysis,
      sections: [
        { startSeconds: 0, endSeconds: 1.5, kind: 'intro', energy: 0.2 },
        { startSeconds: 1.5, endSeconds: 3, kind: 'build', energy: 0.5 },
        { startSeconds: 3, endSeconds: 5, kind: 'drop', energy: 0.9 },
        { startSeconds: 5, endSeconds: 7, kind: 'groove', energy: 0.6 },
        { startSeconds: 7, endSeconds: 8, kind: 'break', energy: 0.2 },
      ],
    };
    const markers = musicSectionMarkers(withSections, 8);
    expect(markers.map((row) => row.label)).toEqual(['Intro', 'Build', 'Drop', 'Break']);
  });
});
