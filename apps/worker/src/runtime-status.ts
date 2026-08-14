export type RawLifecycleState = 'ok' | 'unconfigured' | 'unknown';

export const runtimeStatus = {
  geminiBlocked: false,
  rawLifecycle: 'unknown' as RawLifecycleState,
};
