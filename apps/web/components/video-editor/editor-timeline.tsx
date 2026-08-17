'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  activeSequence,
  formatProjectTimecode,
  sequenceDurationMs,
  type ProjectClip,
  type TimelineTrack,
  type VideoProject,
} from '@reelops/shared';
import { getPlayback, setPlayback, subscribePlayback } from './playback-store';
import { filmstripForMedia } from './thumbnails';
import { peaksForMedia } from './waveform';
import { cn } from '@/lib/utils';

type Drag =
  | { kind: 'scrub' }
  | { kind: 'move'; clipId: string; startX: number; startMs: number }
  | { kind: 'trim'; clipId: string; edge: 'left' | 'right'; startX: number };

export default function EditorTimeline({
  project,
  selectedId,
  zoom,
  snap,
  onSelect,
  onTrim,
  onMove,
  onSplitAt,
  onDropMedia,
  onDropTransition,
  onGestureStart,
  onGestureEnd,
}: {
  project: VideoProject;
  selectedId: string | null;
  zoom: number;
  snap: boolean;
  onSelect: (clipId: string | null) => void;
  onTrim: (clipId: string, edge: 'left' | 'right', timeMs: number) => void;
  onMove: (clipId: string, timeMs: number) => void;
  onSplitAt: (timeMs: number) => void;
  onDropMedia: (mediaId: string, timeMs: number, trackId: string) => void;
  onDropTransition: (clipId: string, type: string) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}) {
  const sequence = activeSequence(project);
  const duration = Math.max(4000, sequenceDurationMs(sequence));
  const pps = 48 * zoom;
  const width = Math.max(640, (duration / 1000) * pps + 80);
  const scroller = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [strips, setStrips] = useState<Record<string, string[]>>({});
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});

  useEffect(() => {
    const sync = () => {
      if (!playhead.current) return;
      playhead.current.style.left = `${12 + (getPlayback().timeMs / 1000) * pps}px`;
    };
    sync();
    return subscribePlayback(sync);
  }, [pps]);

  useEffect(() => {
    let cancelled = false;
    for (const asset of project.media) {
      if (!asset.previewUrl) continue;
      if (asset.kind === 'video') {
        void filmstripForMedia(asset.previewUrl, asset.id, asset.durationMs || 4000, 6)
          .then((frames) => {
            if (!cancelled && frames.length)
              setStrips((current) => ({ ...current, [asset.id]: frames }));
          })
          .catch(() => undefined);
      }
      if (asset.hasAudio) {
        void peaksForMedia(asset.previewUrl, asset.id, 80).then((wave) => {
          if (!cancelled && wave) setPeaks((current) => ({ ...current, [asset.id]: wave }));
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [project.media]);

  const ticks = useMemo(() => {
    const step = zoom < 0.7 ? 5 : zoom < 1.4 ? 1 : 0.5;
    const marks: number[] = [];
    for (let t = 0; t <= duration / 1000 + 0.01; t += step) marks.push(t);
    return marks;
  }, [duration, zoom]);

  function timeFromX(clientX: number) {
    const el = scroller.current;
    if (!el) return 0;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - 12;
    return Math.max(0, (x / pps) * 1000);
  }

  function onPointerDown(event: React.PointerEvent, next: Drag) {
    drag.current = next;
    if (next.kind === 'trim' || next.kind === 'move') onGestureStart?.();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    const current = drag.current;
    if (!current) return;
    const time = timeFromX(event.clientX);
    if (current.kind === 'scrub') {
      setPlayback({ timeMs: Math.min(duration, time), playing: false });
    } else if (current.kind === 'trim') {
      onTrim(current.clipId, current.edge, time);
    } else if (current.kind === 'move') {
      onMove(
        current.clipId,
        Math.max(0, current.startMs + ((event.clientX - current.startX) / pps) * 1000),
      );
    }
  }

  function onPointerUp() {
    if (drag.current?.kind === 'trim' || drag.current?.kind === 'move') onGestureEnd?.();
    drag.current = null;
  }

  return (
    <div className="flex h-full min-h-[220px] flex-col border-t border-[#262d3a] bg-[#08090c]">
      <div
        ref={scroller}
        className="nle-scroll relative min-h-0 flex-1 overflow-auto"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const mediaId = event.dataTransfer.getData('application/x-cenapronta-media');
          const trackEl = (event.target as HTMLElement).closest('[data-track-id]');
          const trackId = trackEl?.getAttribute('data-track-id') ?? 'track_v1';
          if (mediaId) onDropMedia(mediaId, timeFromX(event.clientX), trackId);
        }}
      >
        <div className="relative" style={{ width, minHeight: '100%' }}>
          <div
            data-testid="nle-ruler"
            className="sticky top-0 z-10 h-6 border-b border-[#262d3a] bg-[#10131a]"
            onPointerDown={(event) => {
              setPlayback({ timeMs: timeFromX(event.clientX), playing: false });
              onPointerDown(event, { kind: 'scrub' });
            }}
          >
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute top-0 font-mono text-[9px] text-[#8d97a8]"
                style={{ left: 12 + tick * pps }}
              >
                {formatProjectTimecode(tick * 1000, project.settings.fps).slice(0, 5)}
              </span>
            ))}
            {sequence.markers.map((marker) => (
              <span
                key={marker.id}
                title={marker.label || marker.kind}
                className={cn(
                  'absolute top-0 w-px',
                  marker.kind === 'beat'
                    ? marker.label
                      ? 'h-6 bg-[#d4a24c]/80'
                      : 'h-3 bg-[#d4a24c]/45'
                    : marker.kind === 'highlight'
                      ? 'h-6 w-[2px] bg-[#f2e2b0]'
                      : 'h-5 bg-[#7eb0ff]/70',
                )}
                style={{ left: 12 + (marker.timeMs / 1000) * pps }}
              >
                {marker.kind === 'highlight' && marker.label ? (
                  <span className="absolute left-1 top-0 whitespace-nowrap font-mono text-[8px] uppercase tracking-wide text-[#f2e2b0]/90">
                    {marker.label}
                  </span>
                ) : null}
              </span>
            ))}
          </div>
          {sequence.tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              pps={pps}
              selectedId={selectedId}
              strips={strips}
              peaks={peaks}
              onSelect={onSelect}
              onPointerDown={onPointerDown}
              onDropTransition={onDropTransition}
            />
          ))}
          <div
            ref={playhead}
            className="pointer-events-none absolute top-0 z-20 h-full w-px bg-[#ff3355]"
            style={{ left: 12 }}
          >
            <span className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-[#ff3355]" />
          </div>
        </div>
      </div>
      <p className="sr-only">{snap ? 'snap on' : 'snap off'}</p>
      <button type="button" className="sr-only" onClick={() => onSplitAt(getPlayback().timeMs)}>
        Split at playhead
      </button>
    </div>
  );
}

function TrackRow({
  track,
  pps,
  selectedId,
  strips,
  peaks,
  onSelect,
  onPointerDown,
  onDropTransition,
}: {
  track: TimelineTrack;
  pps: number;
  selectedId: string | null;
  strips: Record<string, string[]>;
  peaks: Record<string, number[]>;
  onSelect: (id: string) => void;
  onPointerDown: (event: React.PointerEvent, drag: Drag) => void;
  onDropTransition: (clipId: string, type: string) => void;
}) {
  const videoTrack = track.kind === 'video';
  return (
    <div
      className={cn('flex border-b border-[#1a2030]', videoTrack ? 'h-[72px]' : 'h-12')}
      data-track-id={track.id}
    >
      <div className="sticky left-0 z-10 flex w-28 shrink-0 flex-col justify-center border-r border-[#262d3a] bg-[#10131a] px-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#c5cedb]">
          {track.name}
        </span>
        <span className="text-[9px] text-[#8a94a7]">
          {track.kind}
          {track.muted ? ' · M' : ''}
          {track.locked ? ' · L' : ''}
        </span>
      </div>
      <div className="relative flex-1">
        {track.clips.map((clip) => (
          <ClipBlock
            key={clip.id}
            clip={clip}
            pps={pps}
            selected={selectedId === clip.id}
            frames={clip.mediaId ? strips[clip.mediaId] : undefined}
            wave={clip.mediaId ? peaks[clip.mediaId] : undefined}
            onSelect={() => onSelect(clip.id)}
            onPointerDown={onPointerDown}
            onDropTransition={onDropTransition}
          />
        ))}
      </div>
    </div>
  );
}

function ClipBlock({
  clip,
  pps,
  selected,
  frames,
  wave,
  onSelect,
  onPointerDown,
  onDropTransition,
}: {
  clip: ProjectClip;
  pps: number;
  selected: boolean;
  frames?: string[];
  wave?: number[];
  onSelect: () => void;
  onPointerDown: (event: React.PointerEvent, drag: Drag) => void;
  onDropTransition: (clipId: string, type: string) => void;
}) {
  const left = 12 + (clip.timelineStartMs / 1000) * pps;
  const width = Math.max(8, ((clip.timelineEndMs - clip.timelineStartMs) / 1000) * pps);
  const video = clip.kind === 'video';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).dataset.edge) return;
        onSelect();
        onPointerDown(event, {
          kind: 'move',
          clipId: clip.id,
          startX: event.clientX,
          startMs: clip.timelineStartMs,
        });
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const type = event.dataTransfer.getData('application/x-cenapronta-transition');
        if (type) {
          event.preventDefault();
          onDropTransition(clip.id, type);
        }
      }}
      className={cn(
        'absolute overflow-hidden rounded-[3px] border text-left',
        selected ? 'border-[#d4a24c] z-10' : 'border-black/50',
        clip.lockedByUser ? 'ring-1 ring-sky-400/70' : '',
        video
          ? 'top-1.5 bottom-1.5 bg-[#3a4d38]'
          : clip.kind === 'audio'
            ? 'top-1 bottom-1 bg-[#2a3d58]'
            : 'top-1 bottom-1 bg-[#3a2a18]',
      )}
      data-clip-id={clip.id}
      data-testid={`nle-clip-${clip.name}`}
      style={{ left, width }}
    >
      <button
        type="button"
        data-edge="left"
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
        onPointerDown={(event) => {
          event.stopPropagation();
          onPointerDown(event, {
            kind: 'trim',
            clipId: clip.id,
            edge: 'left',
            startX: event.clientX,
          });
        }}
      />
      {frames?.length && video ? (
        <div className="flex h-[38px] overflow-hidden">
          {frames.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={index} src={src} alt="" className="h-[38px] w-14 object-cover opacity-90" />
          ))}
        </div>
      ) : wave?.length ? (
        <div className="flex h-7 items-end gap-px px-1">
          {wave.slice(0, 40).map((peak, index) => (
            <span
              key={index}
              className="flex-1 bg-[#7eb0ff]"
              style={{ height: `${Math.max(10, peak * 100)}%` }}
            />
          ))}
        </div>
      ) : (
        <div className="h-7 bg-black/20" />
      )}
      <p className="truncate px-1 text-[10px] leading-4">
        {clip.lockedByUser ? '🔒 ' : ''}
        {clip.name}
      </p>
      <button
        type="button"
        data-edge="right"
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
        onPointerDown={(event) => {
          event.stopPropagation();
          onPointerDown(event, {
            kind: 'trim',
            clipId: clip.id,
            edge: 'right',
            startX: event.clientX,
          });
        }}
      />
    </div>
  );
}
