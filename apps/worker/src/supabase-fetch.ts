export const SUPABASE_FETCH_TIMEOUT_MS = 15_000;

export function mergeAbortSignals(signals: AbortSignal[]) {
  const live = signals.filter(Boolean);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(live);
  const controller = new AbortController();
  for (const signal of live) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export function supabaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  const timeout = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS);
  return fetch(input, {
    ...init,
    signal: mergeAbortSignals([init?.signal, timeout].filter(Boolean) as AbortSignal[]),
  });
}
