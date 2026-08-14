export type SceneCut = { timeSeconds: number; score: number };
export type LoudnessSample = { timeSeconds: number; momentary: number; integrated: number };
export type SilenceRange = { startSeconds: number; endSeconds: number };

export type PeakWindow = {
  offsetSeconds: number;
  durationSeconds: number;
  sceneScore: number;
  audioLufs: number | null;
  silenceRatio: number;
  fusedScore: number;
  source: 'ffmpeg_scene' | 'ebur128';
};

const SCENE_TIME = /pts_time:\s*([0-9.]+)/g;
const SCENE_SCORE = /scene_score:\s*([0-9.]+)/gi;
const EBUR_LINE = /t:\s*([0-9.]+).*?\bM:\s*(-?[0-9.]+).*?\bI:\s*(-?[0-9.]+)/g;
const SILENCE_START = /silence_start:\s*(-?[0-9.]+)/g;
const SILENCE_END = /silence_end:\s*(-?[0-9.]+)/g;

export function parseSceneCuts(stderr: string): SceneCut[] {
  const times: number[] = [];
  for (const match of stderr.matchAll(SCENE_TIME)) {
    const time = Number(match[1]);
    if (Number.isFinite(time) && time >= 0) times.push(time);
  }
  const scores: number[] = [];
  for (const match of stderr.matchAll(SCENE_SCORE)) {
    const score = Number(match[1]);
    if (Number.isFinite(score)) scores.push(score);
  }
  return times.map((timeSeconds, index) => ({
    timeSeconds,
    score: scores[index] ?? 0.35,
  }));
}

export function parseLoudness(stderr: string): LoudnessSample[] {
  const samples: LoudnessSample[] = [];
  for (const match of stderr.matchAll(EBUR_LINE)) {
    const timeSeconds = Number(match[1]);
    const momentary = Number(match[2]);
    const integrated = Number(match[3]);
    if (![timeSeconds, momentary, integrated].every(Number.isFinite)) continue;
    samples.push({ timeSeconds, momentary, integrated });
  }
  return samples;
}

export function parseSilences(stderr: string, durationSeconds: number): SilenceRange[] {
  const starts = [...stderr.matchAll(SILENCE_START)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const ends = [...stderr.matchAll(SILENCE_END)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const ranges: SilenceRange[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const startSeconds = Math.max(0, starts[index]);
    const endSeconds = Math.min(durationSeconds, ends[index] ?? durationSeconds);
    if (endSeconds > startSeconds) ranges.push({ startSeconds, endSeconds });
  }
  return ranges;
}

export function silenceRatioAt(ranges: SilenceRange[], start: number, end: number) {
  if (end <= start) return 0;
  let covered = 0;
  for (const range of ranges) {
    const from = Math.max(start, range.startSeconds);
    const to = Math.min(end, range.endSeconds);
    if (to > from) covered += to - from;
  }
  return Math.min(1, covered / (end - start));
}

export function selectPeaks(input: {
  durationSeconds: number;
  scenes: SceneCut[];
  loudness: LoudnessSample[];
  silences: SilenceRange[];
  maxPeaks?: number;
}): PeakWindow[] {
  const duration = Math.max(1, input.durationSeconds);
  const clip = Math.min(12, Math.max(8, Math.round(duration * 0.2) || 8));
  const events: {
    time: number;
    sceneScore: number;
    audioLufs: number | null;
    source: PeakWindow['source'];
  }[] = [];

  for (const scene of input.scenes) {
    events.push({
      time: scene.timeSeconds,
      sceneScore: Math.min(1, scene.score),
      audioLufs: null,
      source: 'ffmpeg_scene',
    });
  }

  const loudPeaks = input.loudness.filter((sample) => sample.momentary > -18);
  for (const sample of loudPeaks) {
    events.push({
      time: sample.timeSeconds,
      sceneScore: 0,
      audioLufs: sample.momentary,
      source: 'ebur128',
    });
  }

  if (!events.length && input.loudness.length) {
    const loudest = input.loudness.reduce((best, sample) =>
      sample.momentary > best.momentary ? sample : best,
    );
    events.push({
      time: loudest.timeSeconds,
      sceneScore: 0,
      audioLufs: loudest.momentary,
      source: 'ebur128',
    });
  }

  const merged: PeakWindow[] = [];
  const sorted = events.sort((a, b) => a.time - b.time);
  for (const event of sorted) {
    const offsetSeconds = Math.max(0, Math.min(duration - 1, event.time - clip / 3));
    const durationSeconds = Math.min(clip, duration - offsetSeconds);
    const nearby = merged.find((peak) => Math.abs(peak.offsetSeconds - offsetSeconds) < 2);
    const silence = silenceRatioAt(input.silences, offsetSeconds, offsetSeconds + durationSeconds);
    const audioNorm =
      event.audioLufs == null ? 0.35 : Math.min(1, Math.max(0, (event.audioLufs + 40) / 30));
    const fusedScore =
      Math.round((event.sceneScore * 45 + audioNorm * 40 + (1 - silence) * 15) * 10) / 10;
    if (nearby) {
      nearby.sceneScore = Math.max(nearby.sceneScore, event.sceneScore);
      nearby.audioLufs =
        nearby.audioLufs == null
          ? event.audioLufs
          : Math.max(nearby.audioLufs, event.audioLufs ?? nearby.audioLufs);
      nearby.fusedScore = Math.max(nearby.fusedScore, fusedScore);
      nearby.source = nearby.sceneScore > 0 ? 'ffmpeg_scene' : nearby.source;
      continue;
    }
    merged.push({
      offsetSeconds: Number(offsetSeconds.toFixed(3)),
      durationSeconds: Number(durationSeconds.toFixed(3)),
      sceneScore: event.sceneScore,
      audioLufs: event.audioLufs,
      silenceRatio: Number(silence.toFixed(4)),
      fusedScore,
      source: event.source,
    });
  }

  return merged
    .filter((peak) => peak.fusedScore >= 32)
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, input.maxPeaks ?? 2);
}
