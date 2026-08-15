export type RawLifecycleState = 'ok' | 'unconfigured' | 'unknown';

export const runtimeStatus = {
  geminiBlocked: false,
  rawLifecycle: 'unknown' as RawLifecycleState,
  yolo: { ok: false, loaded: false, device: null as string | null, reason: 'unknown' },
};
