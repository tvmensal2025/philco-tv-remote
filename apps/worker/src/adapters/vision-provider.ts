export type VisionKind = 'openai' | 'gemini' | 'heuristic';
export type VisionPreference = 'auto' | 'openai' | 'gemini';

export function pickVisionProvider(input: {
  openaiKey?: string;
  geminiKey?: string;
  preference?: VisionPreference;
}): VisionKind {
  const pref = input.preference ?? 'auto';
  if (pref === 'openai') return input.openaiKey ? 'openai' : 'heuristic';
  if (pref === 'gemini') return input.geminiKey ? 'gemini' : 'heuristic';
  if (input.openaiKey) return 'openai';
  if (input.geminiKey) return 'gemini';
  return 'heuristic';
}

export function isRealVisionProvider(kind: VisionKind) {
  return kind === 'openai' || kind === 'gemini';
}

export function isTransientProviderError(message: string) {
  return /429|rate.?limit|timeout|temporar|unavailable|econnreset|socket hang up|5\d\d|PROVIDER_BLOCKED|GEMINI_API_BLOCKED|OPENAI_API_BLOCKED/i.test(
    message,
  );
}

export function isHiddenBugFallback(message: string) {
  return /OUR_SCHEMA_BUG|INVALID_INPUT|MISSING_RECORDING|TENANT_ERROR|CORRUPT|DIRECTOR_INVALID_OUTPUT/i.test(
    message,
  );
}
