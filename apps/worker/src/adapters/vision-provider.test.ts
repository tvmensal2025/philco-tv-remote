import { describe, expect, it } from 'vitest';
import {
  isHiddenBugFallback,
  isRealVisionProvider,
  isTransientProviderError,
  pickVisionProvider,
} from './vision-provider.js';

describe('pickVisionProvider', () => {
  it('prefers OpenAI in auto when both keys exist', () => {
    expect(
      pickVisionProvider({ openaiKey: 'sk-test', geminiKey: 'AIza', preference: 'auto' }),
    ).toBe('openai');
  });

  it('uses Gemini when OpenAI is absent', () => {
    expect(pickVisionProvider({ geminiKey: 'AIza', preference: 'auto' })).toBe('gemini');
  });

  it('falls back to heuristic without keys', () => {
    expect(pickVisionProvider({ preference: 'openai' })).toBe('heuristic');
    expect(isRealVisionProvider('heuristic')).toBe(false);
    expect(isRealVisionProvider('openai')).toBe(true);
  });

  it('allows blocked/rate-limit fallback and hides schema bugs', () => {
    expect(isTransientProviderError('OPENAI_API_BLOCKED')).toBe(true);
    expect(isTransientProviderError('429 rate limit')).toBe(true);
    expect(isHiddenBugFallback('DIRECTOR_INVALID_OUTPUT')).toBe(true);
    expect(isHiddenBugFallback('OPENAI_API_BLOCKED')).toBe(false);
  });
});
