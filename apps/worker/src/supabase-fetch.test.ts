import { describe, expect, it, vi } from 'vitest';
import { mergeAbortSignals, SUPABASE_FETCH_TIMEOUT_MS } from './supabase-fetch.js';

describe('mergeAbortSignals', () => {
  it('returns the only signal', () => {
    const signal = AbortSignal.timeout(1_000);
    expect(mergeAbortSignals([signal])).toBe(signal);
  });

  it('aborts when either signal aborts', async () => {
    const first = new AbortController();
    const second = new AbortController();
    const merged = mergeAbortSignals([first.signal, second.signal]);
    expect(merged?.aborted).toBe(false);
    second.abort('stop');
    await vi.waitFor(() => expect(merged?.aborted).toBe(true));
  });
});

describe('supabase fetch timeout', () => {
  it('uses a 15s budget so a hung keep-alive cannot freeze heartbeats', () => {
    expect(SUPABASE_FETCH_TIMEOUT_MS).toBe(15_000);
  });
});
