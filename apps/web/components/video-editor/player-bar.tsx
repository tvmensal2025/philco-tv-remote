'use client';

import {
  FastForward,
  Maximize2,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  formatProjectTimecode,
  type VideoProject,
  sequenceDurationMs,
  activeSequence,
} from '@reelops/shared';
import { setPlayback, usePlayback } from './playback-store';

export default function PlayerBar({ project }: { project: VideoProject }) {
  const playback = usePlayback();
  const duration = Math.max(playback.durationMs, sequenceDurationMs(activeSequence(project)));
  const fps = project.settings.fps;
  const frameMs = 1000 / fps;

  function seek(next: number) {
    setPlayback({ timeMs: Math.max(0, Math.min(duration, next)), playing: false });
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 border-t border-[#262d3a] bg-[#10131a] px-3">
      <button type="button" className="nle-icon" title="Início" onClick={() => seek(0)}>
        <SkipBack className="size-3.5" />
      </button>
      <button
        type="button"
        className="nle-icon"
        title="Frame anterior"
        onClick={() => seek(playback.timeMs - frameMs)}
      >
        <Rewind className="size-3.5" />
      </button>
      <button
        type="button"
        className="flex size-8 items-center justify-center rounded-sm bg-[#d4a24c] text-black"
        title={playback.playing ? 'Pausar' : 'Play'}
        onClick={() => setPlayback({ playing: !playback.playing })}
      >
        {playback.playing ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 fill-current" />
        )}
      </button>
      <button
        type="button"
        className="nle-icon"
        title="Próximo frame"
        onClick={() => seek(playback.timeMs + frameMs)}
      >
        <FastForward className="size-3.5" />
      </button>
      <button type="button" className="nle-icon" title="Fim" onClick={() => seek(duration)}>
        <SkipForward className="size-3.5" />
      </button>
      <span className="ml-2 font-mono text-[11px] tabular-nums text-[#e6ebf3]">
        {formatProjectTimecode(playback.timeMs, fps)}
        <span className="text-[#8d97a8]"> / {formatProjectTimecode(duration, fps)}</span>
      </span>
      <button
        type="button"
        className="nle-icon ml-auto"
        title={playback.muted ? 'Som' : 'Mudo'}
        onClick={() => setPlayback({ muted: !playback.muted })}
      >
        {playback.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={playback.muted ? 0 : playback.volume}
        onChange={(event) => setPlayback({ volume: Number(event.target.value), muted: false })}
        className="h-1 w-20 accent-[#d4a24c]"
      />
      <span className="text-[10px] uppercase tracking-wider text-[#8d97a8]">Preview</span>
      <Maximize2 className="size-3.5 text-[#8d97a8]" />
    </div>
  );
}
