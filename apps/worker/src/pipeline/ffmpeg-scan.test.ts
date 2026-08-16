import {
  parseLoudness,
  parseSceneCuts,
  parseSilences,
  selectPeaks,
  midrollBlackHits,
  type PeakWindow,
} from './ffmpeg-scan.js';
import { describe, expect, it } from 'vitest';

const sceneLog = `
[Parsed_showinfo_1 @ 0] n:   0 pts:  45045 pts_time:1.5015 pos:123
lavfi.scene_score:0.42
[Parsed_showinfo_1 @ 0] n:   1 pts: 180180 pts_time:6.006 pos:999
lavfi.scene_score:0.51
`;

const eburLog = `
[Parsed_ebur128_0 @ 0] t: 1.5        TARGET:-23 LUFS    M: -12.4 S: -18.2     I: -22.1 LUFS
[Parsed_ebur128_0 @ 0] t: 12.0       TARGET:-23 LUFS    M: -28.0 S: -24.1     I: -23.0 LUFS
`;

const silenceLog = `
[silencedetect @ 0] silence_start: 8.0
[silencedetect @ 0] silence_end: 11.5 | silence_duration: 3.5
`;

describe('ffmpeg-scan', () => {
  it('parses scene cuts and loudness peaks from ffmpeg stderr', () => {
    expect(parseSceneCuts(sceneLog)).toEqual([
      { timeSeconds: 1.5015, score: 0.42 },
      { timeSeconds: 6.006, score: 0.51 },
    ]);
    expect(parseLoudness(eburLog)[0]).toMatchObject({ timeSeconds: 1.5, momentary: -12.4 });
    expect(parseSilences(silenceLog, 60)).toEqual([{ startSeconds: 8, endSeconds: 11.5 }]);
  });

  it('keeps a small number of fused peaks per segment', () => {
    const peaks: PeakWindow[] = selectPeaks({
      durationSeconds: 60,
      scenes: parseSceneCuts(sceneLog),
      loudness: parseLoudness(eburLog),
      silences: parseSilences(silenceLog, 60),
      maxPeaks: 2,
    });
    expect(peaks.length).toBeGreaterThan(0);
    expect(peaks.length).toBeLessThanOrEqual(2);
    expect(peaks[0].fusedScore).toBeGreaterThanOrEqual(peaks.at(-1)?.fusedScore ?? 0);
  });

  it('treats mid-roll black as a fail and ignores open/close fades', () => {
    const log = `
[blackdetect @ 0] black_start:0 black_end:0.7
[blackdetect @ 0] black_start:4.2 black_end:19.8
[blackdetect @ 0] black_start:19.1 black_end:20.4
`;
    expect(midrollBlackHits(log, 20.4)).toEqual([{ start: 4.2, end: 19.8 }]);
    expect(midrollBlackHits('[blackdetect @ 0] black_start:19.2 black_end:20.4', 20.4)).toEqual([]);
  });
});
