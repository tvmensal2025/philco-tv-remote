import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export type VoiceRequest = {
  text: string;
  voiceId?: string;
  tenantId: string;
  restaurantId: string;
  outputDir: string;
};

export type AudioAsset = {
  path: string;
  durationMs: number;
  provider: 'elevenlabs';
  voiceId: string;
  characters: number;
};

export interface VoiceProvider {
  synthesize(input: VoiceRequest): Promise<AudioAsset>;
}

export type ElevenLabsVoiceSettings = {
  apiKey: string;
  voiceId: string;
  modelId: string;
  timeoutMs: number;
  language?: string;
  outputFormat?: string;
};

const GENERIC_VOICEOVER =
  /experiência inesquecível|sabores que encantam|momentos únicos|desconto|promoção|r\$/i;
const MAX_VOICEOVER_CHARS = 180;

export function voiceConfigured(input: { enabled: boolean; apiKey?: string; voiceId?: string }) {
  return Boolean(input.enabled && input.apiKey?.trim() && input.voiceId?.trim());
}

export function isVoiceConfigured() {
  return voiceConfigured({
    enabled: config.ENABLE_ELEVENLABS,
    apiKey: config.ELEVENLABS_API_KEY,
    voiceId: config.ELEVENLABS_VOICE_ID,
  });
}

export function voiceoverScript(input: {
  title?: string | null;
  subtitle?: string | null;
  caption?: string | null;
}) {
  const parts = [input.title, input.subtitle, input.caption]
    .map((value) => value?.replace(/\s+/g, ' ').trim() ?? '')
    .filter((value) => value.length >= 8 && !GENERIC_VOICEOVER.test(value));
  const unique = [...new Set(parts)];
  const text = unique.join('. ').trim();
  if (text.length < 8) return null;
  return text.slice(0, MAX_VOICEOVER_CHARS);
}

export class DisabledVoiceProvider implements VoiceProvider {
  async synthesize(): Promise<AudioAsset> {
    throw new Error('VOICE_DISABLED');
  }
}

export class ElevenLabsVoiceProvider implements VoiceProvider {
  constructor(
    private readonly settings: ElevenLabsVoiceSettings,
    private readonly io: {
      writeFile?: typeof writeFile;
      probeDurationMs: (file: string) => Promise<number>;
      fetch?: typeof fetch;
    },
  ) {}

  async synthesize(input: VoiceRequest): Promise<AudioAsset> {
    const text = input.text.replace(/\s+/g, ' ').trim().slice(0, MAX_VOICEOVER_CHARS);
    if (text.length < 8) throw new Error('ELEVENLABS_TEXT_EMPTY');
    const voiceId = (input.voiceId?.trim() || this.settings.voiceId).trim();
    if (!voiceId) throw new Error('ELEVENLABS_VOICE_MISSING');
    const format = this.settings.outputFormat ?? 'mp3_44100_128';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    try {
      const body: Record<string, unknown> = {
        text,
        model_id: this.settings.modelId,
      };
      if (this.settings.language && /flash|turbo/i.test(this.settings.modelId)) {
        body.language_code = this.settings.language;
      }
      const fetchImpl = this.io.fetch ?? fetch;
      const response = await fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(format)}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': this.settings.apiKey,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 180);
        if (response.status === 401 || response.status === 403)
          throw new Error('ELEVENLABS_UNAUTHORIZED');
        if (response.status === 429) throw new Error('ELEVENLABS_RATE_LIMIT');
        throw new Error(`ELEVENLABS_HTTP_${response.status}:${detail}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new Error('ELEVENLABS_EMPTY');
      const file = path.join(input.outputDir, 'voiceover.mp3');
      await (this.io.writeFile ?? writeFile)(file, buffer);
      const durationMs = await this.io.probeDurationMs(file);
      return {
        path: file,
        durationMs,
        provider: 'elevenlabs',
        voiceId,
        characters: text.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/abort/i.test(message)) throw new Error('ELEVENLABS_TIMEOUT');
      throw error instanceof Error ? error : new Error(message);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createVoiceProvider(): VoiceProvider {
  if (!isVoiceConfigured()) return new DisabledVoiceProvider();
  return new ElevenLabsVoiceProvider(
    {
      apiKey: config.ELEVENLABS_API_KEY!,
      voiceId: config.ELEVENLABS_VOICE_ID!,
      modelId: config.ELEVENLABS_MODEL_ID,
      timeoutMs: config.ELEVENLABS_TIMEOUT_MS,
      language: 'pt',
    },
    {
      probeDurationMs: async (file) => {
        const { probeDuration } = await import('../pipeline/ffmpeg.js');
        return Math.round((await probeDuration(file)) * 1000);
      },
    },
  );
}
