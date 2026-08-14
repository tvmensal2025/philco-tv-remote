import { describe, expect, it, vi } from 'vitest';
import { ElevenLabsVoiceProvider, voiceConfigured, voiceoverScript } from './voice.js';

describe('voiceover script', () => {
  it('joins title and caption, drops generic marketing copy', () => {
    expect(
      voiceoverScript({
        title: 'Café da casa',
        subtitle: null,
        caption: 'Café da casa',
      }),
    ).toBe('Café da casa');
    expect(
      voiceoverScript({
        title: 'Experiência inesquecível',
        caption: 'Pão na chapa com manteiga',
      }),
    ).toBe('Pão na chapa com manteiga');
    expect(voiceoverScript({ title: 'ok' })).toBeNull();
  });

  it('caps at 180 characters', () => {
    const caption = 'A'.repeat(200);
    expect(voiceoverScript({ caption })?.length).toBe(180);
  });
});

describe('voice configuration', () => {
  it('needs flag, key and voice id together', () => {
    expect(voiceConfigured({ enabled: true, apiKey: 'x'.repeat(24), voiceId: 'PauloVoice' })).toBe(
      true,
    );
    expect(voiceConfigured({ enabled: false, apiKey: 'x'.repeat(24), voiceId: 'PauloVoice' })).toBe(
      false,
    );
    expect(voiceConfigured({ enabled: true, apiKey: 'x'.repeat(24) })).toBe(false);
  });
});

describe('ElevenLabsVoiceProvider', () => {
  it('writes the mp3 from a successful convert call', async () => {
    const writeFile = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(
      async () =>
        new Response(Buffer.from('ID3fake'), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        }),
    );
    const provider = new ElevenLabsVoiceProvider(
      {
        apiKey: 'sk_test_elevenlabs_key_ok',
        voiceId: 'Qrdut83w0Cr152Yb4Xn3',
        modelId: 'eleven_multilingual_v2',
        timeoutMs: 5_000,
        language: 'pt',
      },
      {
        writeFile: writeFile as never,
        probeDurationMs: async () => 2100,
        fetch: fetchImpl as never,
      },
    );
    const asset = await provider.synthesize({
      text: 'Café da casa no centro da mesa',
      tenantId: '11111111-1111-1111-1111-111111111111',
      restaurantId: '22222222-2222-2222-2222-222222222222',
      outputDir: 'work/voice',
    });
    expect(asset.provider).toBe('elevenlabs');
    expect(asset.durationMs).toBe(2100);
    expect(asset.path).toMatch(/voiceover\.mp3$/);
    expect(writeFile).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v1/text-to-speech/Qrdut83w0Cr152Yb4Xn3');
    expect(url).toContain('output_format=mp3_44100_128');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe(
      'sk_test_elevenlabs_key_ok',
    );
    const body = JSON.parse(String(init.body)) as {
      language_code?: string;
      model_id: string;
      text: string;
    };
    expect(body.language_code).toBeUndefined();
    expect(body.model_id).toBe('eleven_multilingual_v2');
    expect(body.text).toContain('Café da casa');
  });

  it('maps unauthorized and empty payloads', async () => {
    const unauthorized = new ElevenLabsVoiceProvider(
      {
        apiKey: 'sk_bad',
        voiceId: 'voice-1',
        modelId: 'eleven_multilingual_v2',
        timeoutMs: 5_000,
      },
      {
        probeDurationMs: async () => 0,
        fetch: async () => new Response('nope', { status: 401 }),
      },
    );
    await expect(
      unauthorized.synthesize({
        text: 'Café da casa no centro',
        tenantId: 't',
        restaurantId: 'r',
        outputDir: 'work',
      }),
    ).rejects.toThrow(/ELEVENLABS_UNAUTHORIZED/);

    const empty = new ElevenLabsVoiceProvider(
      {
        apiKey: 'sk_ok_key_with_enough_len',
        voiceId: 'voice-1',
        modelId: 'eleven_multilingual_v2',
        timeoutMs: 5_000,
      },
      {
        probeDurationMs: async () => 0,
        fetch: async () => new Response(new Uint8Array(), { status: 200 }),
      },
    );
    await expect(
      empty.synthesize({
        text: 'Café da casa no centro',
        tenantId: 't',
        restaurantId: 'r',
        outputDir: 'work',
      }),
    ).rejects.toThrow(/ELEVENLABS_EMPTY/);
  });
});
