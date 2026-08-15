'use client';

import { useSyncExternalStore } from 'react';

export type PlaybackState = {
  timeMs: number;
  playing: boolean;
  durationMs: number;
  volume: number;
  muted: boolean;
};

let state: PlaybackState = {
  timeMs: 0,
  playing: false,
  durationMs: 0,
  volume: 1,
  muted: false,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getPlayback() {
  return state;
}

export function setPlayback(patch: Partial<PlaybackState>) {
  state = { ...state, ...patch };
  emit();
}

export function subscribePlayback(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlayback() {
  return useSyncExternalStore(subscribePlayback, getPlayback, getPlayback);
}

export function usePlaybackField<K extends keyof PlaybackState>(key: K): PlaybackState[K] {
  return useSyncExternalStore(
    subscribePlayback,
    () => state[key],
    () => state[key],
  );
}

export function resetPlayback(durationMs = 0) {
  state = { timeMs: 0, playing: false, durationMs, volume: state.volume, muted: state.muted };
  emit();
}
