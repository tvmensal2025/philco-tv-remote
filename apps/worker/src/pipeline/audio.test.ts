import { describe, expect, it } from 'vitest';
import { assertLicensedMusic, duckingFilter, mixVoiceoverGraph } from './audio.js';

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
    expect(graph).toContain('asplit=2');
    expect(graph).toContain('sidechaincompress');
    expect(graph).toContain('loudnorm=I=-16');
    expect(graph).toContain('[outa]');
  });

  it('uses the voiceover alone when there is no ambient bed', () => {
    const graph = mixVoiceoverGraph({ voiceInputIndex: 2, duration: 8 });
    expect(graph).not.toContain('sidechaincompress');
    expect(graph).toContain('[2:a]aresample=48000');
    expect(graph).toContain('[outa]');
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
});
