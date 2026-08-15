export type DuckingConfig = {
  attack: number;
  release: number;
  threshold: number;
  ratio: number;
  musicGain: number;
  voiceGain: number;
  ambientGain: number;
};

export const defaultDucking: DuckingConfig = {
  attack: 80,
  release: 250,
  threshold: -24,
  ratio: 8,
  musicGain: 0.55,
  voiceGain: 1,
  ambientGain: 0.7,
};

export function duckingFilter(config: DuckingConfig = defaultDucking) {
  const music = `[music]volume=${config.musicGain}[m]`;
  const voice = `[voice]volume=${config.voiceGain}[v]`;
  const split = `[v]asplit=2[vduck][vmix]`;
  const sidechain = `[m][vduck]sidechaincompress=threshold=${config.threshold}dB:ratio=${config.ratio}:attack=${config.attack}:release=${config.release}[ducked]`;
  const mix = `[ducked][vmix]amix=inputs=2:duration=first:dropout_transition=2[mixed]`;
  return `${music};${voice};${split};${sidechain};${mix}`;
}

export const DELIVERY_AUDIO_SAMPLE_RATE = 48000;
export const DELIVERY_AUDIO_CHANNELS = 2;

export function deliveryAudioFilter() {
  return 'aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
}

export function deliveryAudioEncodeArgs() {
  return ['-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k'] as const;
}

export function mixVoiceoverGraph(input: {
  ambientInputIndex?: number;
  ambientStart?: number;
  voiceInputIndex: number;
  duration: number;
  ducking?: DuckingConfig;
}) {
  const config = input.ducking ?? defaultDucking;
  const fadeOutStart = Math.max(0, input.duration - 0.8);
  const voice = `[${input.voiceInputIndex}:a]${deliveryAudioFilter()},volume=${config.voiceGain},apad=whole_dur=${input.duration}[vsrc]`;
  if (input.ambientInputIndex == null) {
    return `${voice};[vsrc]afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeOutStart}:d=0.8,loudnorm=I=-16:TP=-1.5:LRA=11[outa]`;
  }
  const start = input.ambientStart ?? 0;
  const ambient = `[${input.ambientInputIndex}:a]atrim=start=${start}:duration=${input.duration},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.55,afade=t=out:st=${fadeOutStart}:d=0.8,${deliveryAudioFilter()},volume=${config.ambientGain}[ambient]`;
  const duck = `[vsrc]asplit=2[vduck][vmix];[ambient][vduck]sidechaincompress=threshold=${config.threshold}dB:ratio=${config.ratio}:attack=${config.attack}:release=${config.release}[ducked];[ducked][vmix]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=11[outa]`;
  return `${ambient};${voice};${duck}`;
}

export type LicensedMusicAsset = {
  source: string;
  licenseType: 'owned' | 'licensed' | 'unknown';
  licenseReference?: string;
  provider: string;
  assetId: string;
  allowedUsage: string[];
};

export function assertLicensedMusic(asset: LicensedMusicAsset) {
  if (asset.licenseType === 'unknown' || !asset.licenseReference) {
    throw new Error('MUSIC_LICENSE_UNKNOWN');
  }
}
