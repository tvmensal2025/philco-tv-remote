export type RenderProfile = 'high' | 'standard' | 'safe';
export type RenderWarning = 'MOTION_FILTER_MEMORY_FALLBACK' | 'RENDER_PROFILE_DOWNGRADE';
export type RenderResult = {
  profile: 'high' | 'standard' | 'safe' | 'safe_fallback';
  warning?: RenderWarning;
};

export function isFfmpegMemoryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot allocate memory|out of memory|enomem|std::bad_alloc|killed process|signal 9|exit code 137/i.test(
    message,
  );
}

export function renderProfileOrder(start: RenderProfile): RenderProfile[] {
  if (start === 'safe') return ['safe'];
  if (start === 'standard') return ['standard', 'safe'];
  return ['high', 'standard', 'safe'];
}
