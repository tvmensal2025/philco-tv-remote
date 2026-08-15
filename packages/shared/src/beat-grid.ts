/** Musical beat grid: onset → tempo → beats → downbeats → sections. Pure DSP, no FFmpeg. */

export const BEAT_SAMPLE_RATE = 22_050;
export const BEAT_HOP = 512;
export const MIN_BPM = 72;
export const MAX_BPM = 168;

export type MusicBeat = {
  timeSeconds: number;
  strength: number;
  isDownbeat: boolean;
  barIndex: number;
  beatInBar: number;
};

export type MusicSectionKind = 'intro' | 'build' | 'drop' | 'groove' | 'break';

export type MusicSection = {
  startSeconds: number;
  endSeconds: number;
  kind: MusicSectionKind;
  energy: number;
};

export type MusicAnalysis = {
  durationSeconds: number;
  sampleRate: number;
  bpm: number;
  beatPeriodSeconds: number;
  timeSignature: 4;
  offsetSeconds: number;
  confidence: number;
  beats: MusicBeat[];
  downbeats: number[];
  onsets: Array<{ timeSeconds: number; strength: number }>;
  energyCurve: Array<{ timeSeconds: number; rms: number }>;
  sections: MusicSection[];
};

function onePoleLowpass(input: Float32Array, cutoffHz: number, sampleRate: number) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const a = 1 / sampleRate / (rc + 1 / sampleRate);
  const out = new Float32Array(input.length);
  let y = 0;
  for (let i = 0; i < input.length; i += 1) {
    y += a * ((input[i] ?? 0) - y);
    out[i] = y;
  }
  return out;
}

function highpass(input: Float32Array, cutoffHz: number, sampleRate: number) {
  const low = onePoleLowpass(input, cutoffHz, sampleRate);
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) out[i] = (input[i] ?? 0) - (low[i] ?? 0);
  return out;
}

function hopRms(input: Float32Array, hop = BEAT_HOP) {
  const frames = Math.max(1, Math.floor(input.length / hop));
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    const start = f * hop;
    let sum = 0;
    for (let i = 0; i < hop; i += 1) {
      const sample = input[start + i] ?? 0;
      sum += sample * sample;
    }
    out[f] = Math.sqrt(sum / hop);
  }
  return out;
}

function novelty(envelope: Float32Array) {
  const out = new Float32Array(envelope.length);
  out[0] = Math.max(0, envelope[0] ?? 0);
  for (let i = 1; i < envelope.length; i += 1) {
    out[i] = Math.max(0, (envelope[i] ?? 0) - (envelope[i - 1] ?? 0));
  }
  return out;
}

function smooth3(input: Float32Array) {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const a = input[i - 1] ?? input[i] ?? 0;
    const b = input[i] ?? 0;
    const c = input[i + 1] ?? b;
    out[i] = (a + 2 * b + c) / 4;
  }
  return out;
}

function normalize(input: Float32Array) {
  let max = 1e-8;
  for (const value of input) if (value > max) max = value;
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) out[i] = (input[i] ?? 0) / max;
  return out;
}

function peakPick(onset: Float32Array, hopSeconds: number, minGapSeconds = 0.08) {
  const minGap = Math.max(1, Math.round(minGapSeconds / hopSeconds));
  const mean = onset.reduce((sum, value) => sum + value, 0) / Math.max(1, onset.length);
  const threshold = mean * 1.35;
  const peaks: Array<{ timeSeconds: number; strength: number }> = [];
  for (let i = 1; i < onset.length - 1; i += 1) {
    const value = onset[i] ?? 0;
    if (value < threshold) continue;
    if (value < (onset[i - 1] ?? 0) || value < (onset[i + 1] ?? 0)) continue;
    const last = peaks[peaks.length - 1];
    if (last && i * hopSeconds - last.timeSeconds < minGapSeconds) {
      if (value > last.strength)
        peaks[peaks.length - 1] = { timeSeconds: i * hopSeconds, strength: value };
      continue;
    }
    if (last && i - Math.round(last.timeSeconds / hopSeconds) < minGap && value <= last.strength)
      continue;
    peaks.push({ timeSeconds: i * hopSeconds, strength: value });
  }
  return peaks;
}

function estimateTempo(onset: Float32Array, hopSeconds: number) {
  const minLag = Math.round(60 / MAX_BPM / hopSeconds);
  const maxLag = Math.round(60 / MIN_BPM / hopSeconds);
  let bestIndex = 0;
  let best = 0;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let acc = 0;
    let count = 0;
    for (let i = 0; i + lag < onset.length; i += 1) {
      acc += (onset[i] ?? 0) * (onset[i + lag] ?? 0);
      count += 1;
    }
    const score = count ? acc / count : 0;
    scores.push(score);
    if (score > best) {
      best = score;
      bestIndex = scores.length - 1;
    }
  }
  const y0 = scores[bestIndex - 1] ?? scores[bestIndex] ?? 0;
  const y1 = scores[bestIndex] ?? 0;
  const y2 = scores[bestIndex + 1] ?? y1;
  const denom = 2 * y1 - y0 - y2;
  const delta = Math.abs(denom) < 1e-9 ? 0 : (y0 - y2) / (2 * denom);
  const lag = minLag + bestIndex + Math.max(-0.5, Math.min(0.5, delta));
  let bpm = 60 / (lag * hopSeconds);
  if (bpm > 148) {
    const half = bpm / 2;
    if (half >= MIN_BPM) bpm = half;
  } else if (bpm < 84) {
    const doubled = bpm * 2;
    if (doubled <= MAX_BPM) bpm = doubled;
  }
  bpm = refineBpm(onset, hopSeconds, bpm);
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 1e-8;
  const confidence = Math.max(0, Math.min(1, (best / (median + 1e-8) - 1) / 4));
  return { bpm: Number(bpm.toFixed(2)), confidence: Number(confidence.toFixed(3)) };
}

function combScore(onset: Float32Array, periodFrames: number) {
  const period = Math.max(2, periodFrames);
  let best = 0;
  const steps = Math.max(8, Math.round(period));
  for (let phase = 0; phase < steps; phase += 1) {
    let score = 0;
    for (let step = 0; phase + step * period < onset.length; step += 1) {
      const index = Math.round(phase + step * period);
      score += onset[index] ?? 0;
    }
    if (score > best) best = score;
  }
  return best;
}

function refineBpm(onset: Float32Array, hopSeconds: number, bpm0: number) {
  let best = bpm0;
  let bestScore = -1;
  for (let bpm = bpm0 - 4; bpm <= bpm0 + 4; bpm += 0.25) {
    if (bpm < MIN_BPM || bpm > MAX_BPM) continue;
    const score = combScore(onset, 60 / bpm / hopSeconds);
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return best;
}

function argmax(values: Float32Array) {
  let index = 0;
  let best = -1;
  for (let i = 0; i < values.length; i += 1) {
    if ((values[i] ?? 0) > best) {
      best = values[i] ?? 0;
      index = i;
    }
  }
  return index;
}

function trackBeats(onset: Float32Array, hopSeconds: number, bpm: number): MusicBeat[] {
  const period = 60 / bpm / hopSeconds;
  const peak = argmax(onset);
  const search = Math.max(2, Math.round(period * 0.18));
  const beats: MusicBeat[] = [];
  const firstK = -Math.floor(peak / period) - 1;
  for (let k = firstK; ; k += 1) {
    const predicted = peak + k * period;
    if (predicted > onset.length - 1) break;
    if (predicted < -search) continue;
    let bestIndex = Math.round(predicted);
    let bestValue = -1;
    for (let delta = -search; delta <= search; delta += 1) {
      const index = Math.round(predicted) + delta;
      if (index < 0 || index >= onset.length) continue;
      const value = onset[index] ?? 0;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    if (bestValue <= 0 && predicted < 0) continue;
    beats.push({
      timeSeconds: Number((Math.max(0, bestIndex) * hopSeconds).toFixed(4)),
      strength: Number(Math.max(0, Math.min(1, bestValue)).toFixed(4)),
      isDownbeat: false,
      barIndex: 0,
      beatInBar: 1,
    });
  }
  return beats.filter((beat, index, rows) => {
    if (index === 0) return true;
    return beat.timeSeconds - (rows[index - 1]?.timeSeconds ?? 0) >= hopSeconds * 4;
  });
}

function markDownbeats(beats: MusicBeat[], low: Float32Array, hopSeconds: number): MusicBeat[] {
  if (beats.length < 4) return beats;
  const scores = [0, 0, 0, 0];
  for (let phase = 0; phase < 4; phase += 1) {
    for (let i = phase; i < beats.length; i += 4) {
      const frame = Math.round((beats[i]?.timeSeconds ?? 0) / hopSeconds);
      scores[phase] += (low[frame] ?? 0) + (beats[i]?.strength ?? 0) * 0.55;
    }
  }
  let bestPhase = 0;
  for (let phase = 1; phase < 4; phase += 1) {
    if ((scores[phase] ?? 0) > (scores[bestPhase] ?? 0)) bestPhase = phase;
  }
  return beats.map((beat, index) => {
    const aligned = index - bestPhase;
    const beatInBar = ((((aligned % 4) + 4) % 4) + 1) as 1 | 2 | 3 | 4;
    const barIndex = aligned < 0 ? 0 : Math.floor(aligned / 4);
    return { ...beat, isDownbeat: beatInBar === 1 && aligned >= 0, barIndex, beatInBar };
  });
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function sectionsFromBars(
  beats: MusicBeat[],
  energy: Float32Array,
  hopSeconds: number,
): MusicSection[] {
  const downbeats = beats.filter((beat) => beat.isDownbeat);
  if (downbeats.length < 2) {
    return [
      {
        startSeconds: 0,
        endSeconds: beats.at(-1)?.timeSeconds ?? 0,
        kind: 'groove',
        energy: 0.5,
      },
    ];
  }
  const bars = downbeats.map((beat, index) => {
    const start = beat.timeSeconds;
    const end = downbeats[index + 1]?.timeSeconds ?? start + 4 * (beats[1]?.timeSeconds ?? 0.5);
    const from = Math.round(start / hopSeconds);
    const to = Math.max(from + 1, Math.round(end / hopSeconds));
    let sum = 0;
    for (let i = from; i < Math.min(to, energy.length); i += 1) sum += energy[i] ?? 0;
    return { start, end, energy: sum / Math.max(1, to - from) };
  });
  const mid = median(bars.map((bar) => bar.energy)) || 1e-8;
  return bars.map((bar, index) => {
    const previous = bars[index - 1]?.energy ?? bar.energy;
    const next = bars[index + 1]?.energy ?? bar.energy;
    let kind: MusicSectionKind = 'groove';
    if (bar.energy < mid * 0.62) kind = index < 2 ? 'intro' : 'break';
    else if (bar.energy > previous * 1.32 && bar.energy > mid * 1.08) kind = 'drop';
    else if (next > bar.energy * 1.18 && bar.energy > previous) kind = 'build';
    return {
      startSeconds: Number(bar.start.toFixed(3)),
      endSeconds: Number(bar.end.toFixed(3)),
      kind,
      energy: Number(bar.energy.toFixed(4)),
    };
  });
}

export function analyzePcm(samples: Float32Array, sampleRate = BEAT_SAMPLE_RATE): MusicAnalysis {
  const durationSeconds = samples.length / Math.max(1, sampleRate);
  const empty = (): MusicAnalysis => ({
    durationSeconds,
    sampleRate,
    bpm: 120,
    beatPeriodSeconds: 0.5,
    timeSignature: 4,
    offsetSeconds: 0,
    confidence: 0,
    beats: [],
    downbeats: [],
    onsets: [],
    energyCurve: [],
    sections: [],
  });
  if (samples.length < sampleRate * 2) return empty();

  const hop = Math.max(256, Math.round((BEAT_HOP * sampleRate) / BEAT_SAMPLE_RATE));
  const hopSeconds = hop / sampleRate;
  const pad = hop * 4;
  const padded = new Float32Array(samples.length + pad);
  padded.set(samples, pad);
  const padSeconds = pad / sampleRate;
  const low = hopRms(onePoleLowpass(padded, 150, sampleRate), hop);
  const mid = hopRms(onePoleLowpass(highpass(padded, 150, sampleRate), 2000, sampleRate), hop);
  const high = hopRms(highpass(padded, 2000, sampleRate), hop);
  const full = hopRms(padded, hop);
  const onset = normalize(
    smooth3(
      (() => {
        const a = novelty(low);
        const b = novelty(mid);
        const c = novelty(high);
        const mixed = new Float32Array(a.length);
        for (let i = 0; i < mixed.length; i += 1) {
          mixed[i] = (a[i] ?? 0) * 1.55 + (b[i] ?? 0) * 1.05 + (c[i] ?? 0) * 0.4;
        }
        return mixed;
      })(),
    ),
  );
  const energy = normalize(full);
  const estimated = estimateTempo(onset, hopSeconds);
  let bpm = estimated.bpm;
  const confidence = estimated.confidence;
  const shift = (time: number) => Number((time - padSeconds).toFixed(4));
  const rawBeats = markDownbeats(trackBeats(onset, hopSeconds, bpm), energy, hopSeconds);
  const tracked = rawBeats
    .map((beat) => ({ ...beat, timeSeconds: shift(beat.timeSeconds) }))
    .filter((beat) => beat.timeSeconds >= -0.03 && beat.timeSeconds <= durationSeconds + 0.05)
    .map((beat) => ({ ...beat, timeSeconds: Math.max(0, beat.timeSeconds) }));
  const ioi = median(
    tracked.slice(1).map((beat, index) => beat.timeSeconds - (tracked[index]?.timeSeconds ?? 0)),
  );
  if (ioi >= 60 / MAX_BPM && ioi <= 60 / MIN_BPM) {
    bpm = Number((60 / ioi).toFixed(2));
  }
  const onsets = peakPick(onset, hopSeconds)
    .map((row) => ({ ...row, timeSeconds: shift(row.timeSeconds) }))
    .filter(
      (row) =>
        row.strength >= 0.22 && row.timeSeconds >= -0.03 && row.timeSeconds <= durationSeconds,
    )
    .map((row) => ({ ...row, timeSeconds: Math.max(0, row.timeSeconds) }))
    .slice(0, 400);
  const energyCurve: MusicAnalysis['energyCurve'] = [];
  for (let i = 0; i < energy.length; i += 2) {
    const time = shift(i * hopSeconds);
    if (time < -0.05 || time > durationSeconds) continue;
    const rms = Math.max(energy[i] ?? 0, energy[i + 1] ?? 0);
    energyCurve.push({
      timeSeconds: Math.max(0, time),
      rms: Number(rms.toFixed(4)),
    });
  }
  const sections = sectionsFromBars(rawBeats, energy, hopSeconds)
    .map((section) => ({
      ...section,
      startSeconds: Math.max(0, shift(section.startSeconds)),
      endSeconds: Math.max(0, shift(section.endSeconds)),
    }))
    .filter((section) => section.endSeconds > section.startSeconds);
  return {
    durationSeconds: Number(durationSeconds.toFixed(3)),
    sampleRate,
    bpm,
    beatPeriodSeconds: Number((60 / bpm).toFixed(4)),
    timeSignature: 4,
    offsetSeconds: 0,
    confidence,
    beats: tracked,
    downbeats: tracked.filter((beat) => beat.isDownbeat).map((beat) => beat.timeSeconds),
    onsets,
    energyCurve,
    sections,
  };
}

export function shiftAnalysis(analysis: MusicAnalysis, offsetSeconds: number): MusicAnalysis {
  if (offsetSeconds < 0.05) return { ...analysis, offsetSeconds: 0 };
  const shift = (time: number) => Number((time - offsetSeconds).toFixed(4));
  const beats = analysis.beats
    .map((beat) => ({ ...beat, timeSeconds: shift(beat.timeSeconds) }))
    .filter((beat) => beat.timeSeconds >= -0.02);
  return {
    ...analysis,
    offsetSeconds: Number(offsetSeconds.toFixed(4)),
    beats,
    downbeats: beats.filter((beat) => beat.isDownbeat).map((beat) => beat.timeSeconds),
    onsets: analysis.onsets
      .map((row) => ({ ...row, timeSeconds: shift(row.timeSeconds) }))
      .filter((row) => row.timeSeconds >= -0.02),
    energyCurve: analysis.energyCurve
      .map((row) => ({ ...row, timeSeconds: shift(row.timeSeconds) }))
      .filter((row) => row.timeSeconds >= -0.02),
    sections: analysis.sections
      .map((section) => ({
        ...section,
        startSeconds: shift(section.startSeconds),
        endSeconds: shift(section.endSeconds),
      }))
      .filter((section) => section.endSeconds > 0),
  };
}

export function alignAnalysisToDownbeat(analysis: MusicAnalysis): MusicAnalysis {
  const limit = Math.min(analysis.beatPeriodSeconds * 8, 4);
  const first =
    analysis.downbeats.find((time) => time >= 0.05 && time <= limit) ??
    analysis.beats.find((beat) => beat.timeSeconds >= 0.05 && beat.timeSeconds <= limit)
      ?.timeSeconds ??
    0;
  return shiftAnalysis(analysis, first);
}

export function alignAnalysisToHook(analysis: MusicAnalysis): MusicAnalysis {
  const drop = analysis.sections.find(
    (section) =>
      (section.kind === 'drop' || section.kind === 'build') &&
      section.startSeconds >= 0.12 &&
      section.startSeconds <= 8,
  );
  if (!drop) return alignAnalysisToDownbeat(analysis);
  const beat = nearestBeat(analysis.beats, drop.startSeconds, {
    preferDownbeat: true,
    maxSeconds: 0.48,
  });
  return shiftAnalysis(analysis, beat?.timeSeconds ?? drop.startSeconds);
}

export function nearestBeat(
  beats: MusicBeat[],
  timeSeconds: number,
  options?: { preferDownbeat?: boolean; maxSeconds?: number },
): MusicBeat | null {
  if (!beats.length) return null;
  const max = options?.maxSeconds ?? 0.28;
  let closest: MusicBeat | null = null;
  let closestDelta = max;
  let downbeat: MusicBeat | null = null;
  let downbeatDelta = max * 1.35;
  for (const beat of beats) {
    const delta = Math.abs(beat.timeSeconds - timeSeconds);
    if (delta < closestDelta) {
      closest = beat;
      closestDelta = delta;
    }
    if (options?.preferDownbeat && beat.isDownbeat && delta < downbeatDelta) {
      downbeat = beat;
      downbeatDelta = delta;
    }
  }
  if (downbeat && closest) {
    if (downbeatDelta <= closestDelta * 1.65) return downbeat;
  }
  return downbeat && !closest ? downbeat : closest;
}

export function pullWindowSeconds(snapStrength: number) {
  const strength = Math.max(0, Math.min(1, snapStrength));
  return 0.045 + strength * 0.2;
}

export function snapTimeToGrid(
  timeSeconds: number,
  analysis: MusicAnalysis,
  options?: { snapStrength?: number; preferDownbeat?: boolean },
) {
  const strength = Math.max(0, Math.min(1, options?.snapStrength ?? 0.5));
  const maxShift = pullWindowSeconds(strength);
  const beat = nearestBeat(analysis.beats, timeSeconds, {
    preferDownbeat: options?.preferDownbeat,
    maxSeconds: maxShift,
  });
  if (!beat) return timeSeconds;
  const delta = beat.timeSeconds - timeSeconds;
  if (Math.abs(delta) < 0.07) return beat.timeSeconds;
  return Number((timeSeconds + delta * strength).toFixed(4));
}

export function sectionAt(analysis: MusicAnalysis, timeSeconds: number): MusicSection | null {
  return (
    analysis.sections.find(
      (section) => timeSeconds >= section.startSeconds && timeSeconds < section.endSeconds,
    ) ??
    analysis.sections.at(-1) ??
    null
  );
}

export function energyAt(analysis: MusicAnalysis, timeSeconds: number) {
  if (!analysis.energyCurve.length) return 0;
  let best = analysis.energyCurve[0]!;
  let delta = Math.abs(best.timeSeconds - timeSeconds);
  for (const row of analysis.energyCurve) {
    const next = Math.abs(row.timeSeconds - timeSeconds);
    if (next < delta) {
      best = row;
      delta = next;
    }
  }
  return best.rms;
}

export function musicMarkers(
  analysis: MusicAnalysis,
  durationSeconds: number,
  max = 160,
): Array<{ timeMs: number; label: string; downbeat: boolean }> {
  const end = Math.max(0, durationSeconds);
  const rows: Array<{ timeMs: number; label: string; downbeat: boolean }> = [];
  for (const beat of analysis.beats) {
    if (beat.timeSeconds < -0.01 || beat.timeSeconds > end + 0.05) continue;
    rows.push({
      timeMs: Math.max(0, Math.round(beat.timeSeconds * 1000)),
      label: beat.isDownbeat ? String(beat.barIndex + 1) : '',
      downbeat: beat.isDownbeat,
    });
    if (rows.length >= max) break;
  }
  return rows;
}

export function musicSectionMarkers(
  analysis: MusicAnalysis,
  durationSeconds: number,
  max = 12,
): Array<{ timeMs: number; label: string; kind: string }> {
  const end = Math.max(0, durationSeconds);
  const seen = new Set<string>();
  const rows: Array<{ timeMs: number; label: string; kind: string }> = [];
  for (const section of analysis.sections) {
    if (section.startSeconds < -0.02 || section.startSeconds > end) continue;
    if (section.kind === 'groove') continue;
    const key = `${section.kind}:${Math.round(section.startSeconds * 2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      timeMs: Math.max(0, Math.round(section.startSeconds * 1000)),
      label:
        section.kind === 'drop'
          ? 'Drop'
          : section.kind === 'build'
            ? 'Build'
            : section.kind === 'break'
              ? 'Break'
              : 'Intro',
      kind: section.kind,
    });
    if (rows.length >= max) break;
  }
  return rows;
}

export function syntheticClickTrack(input: {
  bpm: number;
  durationSeconds: number;
  sampleRate?: number;
  beatsPerBar?: number;
}) {
  const sampleRate = input.sampleRate ?? BEAT_SAMPLE_RATE;
  const beatsPerBar = input.beatsPerBar ?? 4;
  const samples = new Float32Array(Math.round(input.durationSeconds * sampleRate));
  const period = 60 / input.bpm;
  const burst = Math.round(0.01 * sampleRate);
  let beat = 0;
  for (let time = 0; time < input.durationSeconds - 0.01; time += period) {
    const start = Math.round(time * sampleRate);
    const accent = beat % beatsPerBar === 0;
    const amp = accent ? 1 : 0.42;
    for (let i = 0; i < burst && start + i < samples.length; i += 1) {
      const env = 1 - i / burst;
      const t = i / sampleRate;
      samples[start + i] =
        amp *
        env *
        (Math.sin(2 * Math.PI * 70 * t) * (accent ? 1 : 0.35) +
          Math.sin(2 * Math.PI * 1800 * t) * 0.55);
    }
    beat += 1;
  }
  return samples;
}
