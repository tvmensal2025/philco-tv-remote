import { describe, expect, it } from 'vitest';
import {
  assertLicensedMusic,
  deliveryAudioEncodeArgs,
  deliveryAudioFilter,
  duckingFilter,
  mixBackgroundMusicGraph,
  mixVoiceoverGraph,
} from './audio.js';

describe('audio architecture', () => {
  it('builds a sidechain ducking graph without a shell string', () => {
    const graph = duckingFilter();
    expect(graph).toContain('sidechaincompress');
    expect(graph).toContain('attack=80');
    expect(graph).toContain('amix=inputs=2');
  });

  it('ducks ambient under the voiceover and pads the VO to the reel length', () => {
    const graph = mixVoiceoverGraph({
      ambientInputIndex: 0,
      ambientStart: 1.5,
      voiceInputIndex: 3,
      duration: 12,
    });
    expect(graph).toContain('[0:a]atrim=start=1.5:duration=12');
    expect(graph).toContain('[3:a]aresample=48000');
    expect(graph).toContain('aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo');
    expect(graph).toContain('asplit=2');
    expect(graph).toContain('sidechaincompress');
    expect(graph).toContain('loudnorm=I=-16');
    expect(graph.indexOf('loudnorm=I=-16')).toBeLessThan(graph.indexOf('afade=t=out'));
    expect(graph).toContain('[outa]');
  });

  it('uses the voiceover alone when there is no ambient bed', () => {
    const graph = mixVoiceoverGraph({ voiceInputIndex: 2, duration: 8 });
    expect(graph).not.toContain('sidechaincompress');
    expect(graph).toContain('[2:a]aresample=48000');
    expect(graph).toContain('channel_layouts=stereo');
    expect(graph.indexOf('loudnorm=I=-16')).toBeLessThan(graph.indexOf('afade=t=out'));
    expect(graph).toContain('[outa]');
  });

  it('locks delivery audio to AAC 48 kHz stereo', () => {
    expect(deliveryAudioFilter()).toContain('aresample=48000');
    expect(deliveryAudioFilter()).toContain('channel_layouts=stereo');
    expect([...deliveryAudioEncodeArgs()]).toEqual([
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-b:a',
      '192k',
    ]);
  });

  it('refuses music with an unknown license', () => {
    expect(() =>
      assertLicensedMusic({
        source: 'stock.mp3',
        licenseType: 'unknown',
        provider: 'none',
        assetId: 'x',
        allowedUsage: [],
      }),
    ).toThrow(/MUSIC_LICENSE_UNKNOWN/);
  });

  it('lays the owned bed under ambient for a 59s reel', () => {
    const graph = mixBackgroundMusicGraph({
      musicInputIndex: 5,
      ambientInputIndex: 0,
      ambientStart: 2,
      duration: 59,
    });
    expect(graph).toContain('[5:a]atrim=start=0:duration=59');
    expect(graph).toContain('[0:a]atrim=start=2:duration=59');
    expect(graph).toContain('amix=inputs=2');
    expect(graph).toContain('loudnorm=I=-14');
    expect(graph.indexOf('loudnorm=I=-14')).toBeLessThan(graph.indexOf('afade=t=out'));
    expect(graph).toContain('[outa]');
  });

  it('phase-aligns the bed so the downbeat sits at t=0', () => {
    const graph = mixBackgroundMusicGraph({
      musicInputIndex: 5,
      duration: 30,
      musicStart: 0.84,
    });
    expect(graph).toContain('[5:a]atrim=start=0.84:duration=30');
    expect(graph.indexOf('loudnorm=I=-14')).toBeLessThan(graph.indexOf('afade=t=out'));
  });
});
