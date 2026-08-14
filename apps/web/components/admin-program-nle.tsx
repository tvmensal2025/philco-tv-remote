'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePlus2,
  Pause,
  Play,
  Repeat,
  Scissors,
  SkipBack,
  SkipForward,
  Square,
  Undo2,
  Redo2,
  X,
} from 'lucide-react';
import {
  beatScale,
  cameraRoleLabels,
  canSplitAt,
  clipAtTime,
  duplicateBeatAt,
  emptyBeat,
  FACTORY_LIMITS,
  formatTimecode,
  JOIN_DEFAULT_SECONDS,
  JOIN_OVERLAY,
  joinLabels,
  joinOverlayHits,
  joinOverlayLabels,
  joinOverlayNames,
  localTimeInClip,
  motionLabels,
  moveBeat,
  previewAtTime,
  programCapacity,
  splitSpecAtPlayhead,
  type CameraRole,
  type CatalogEffect,
  type JoinName,
  type JoinOverlayName,
  type MotionName,
  type PlaybookBeat,
  type PreviewLayer,
  type ProgramPresetSpec,
} from '@reelops/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export type SpecHistoryMode = 'push' | 'coalesce';

const roles: CameraRole[] = ['master', 'side', 'food', 'ambience'];
const joins: JoinName[] = ['cut', 'dissolve', 'fadeblack'];
const overlays: JoinOverlayName[] = [...joinOverlayNames];
const motions: MotionName[] = ['none', 'drift', 'punch'];

const roleTone: Record<CameraRole, string> = {
  master: 'bg-amber-500/80 border-amber-300/40',
  side: 'bg-sky-500/80 border-sky-200/40',
  food: 'bg-rose-500/80 border-rose-200/40',
  ambience: 'bg-emerald-500/80 border-emerald-200/40',
};

const groupLabels: Record<string, string> = {
  transicao: 'Transição',
  motion: 'Motion',
  take: 'Take',
  legenda: 'Legenda',
  overlay: 'Overlay',
};

function roleOf(beat: PlaybookBeat): CameraRole {
  return beat.roles[0] ?? 'master';
}

type TakeSource = {
  id: string;
  url: string;
  name: string;
  fileDuration: number;
  offsetSeconds: number;
};

function readVideoDuration(file: File) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    video.src = url;
  });
}

function revokeUnused(url: string, remaining: Record<number, TakeSource>) {
  if (!Object.values(remaining).some((item) => item.url === url)) URL.revokeObjectURL(url);
}

function ScenePlate(props: {
  layer: PreviewLayer;
  source?: TakeSource;
  playing: boolean;
  chrome?: boolean;
  className?: string;
}) {
  const role = roleOf(props.layer.beat);
  const label = cameraRoleLabels[role];
  const videoRef = useRef<HTMLVideoElement>(null);
  const targetRef = useRef(0);
  const playingRef = useRef(props.playing);
  const target = Math.max(0, (props.source?.offsetSeconds ?? 0) + props.layer.localTime);
  targetRef.current = target;
  playingRef.current = props.playing;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !props.source) return;
    const duration = Math.max(0, props.source.fileDuration - 0.04);
    const snap = (force: boolean) => {
      const next = Math.min(Math.max(0, targetRef.current), duration);
      const drift = Math.abs(video.currentTime - next);
      if (force || !playingRef.current || drift > 0.45) video.currentTime = next;
    };
    const onReady = () => snap(true);
    video.addEventListener('loadedmetadata', onReady);
    if (video.readyState >= 1) snap(true);
    return () => video.removeEventListener('loadedmetadata', onReady);
  }, [props.source]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !props.source) return;
    const duration = Math.max(0, props.source.fileDuration - 0.04);
    const next = Math.min(Math.max(0, targetRef.current), duration);
    if (!props.playing) {
      video.pause();
      if (Math.abs(video.currentTime - next) > 0.03) video.currentTime = next;
      return;
    }
    if (Math.abs(video.currentTime - next) > 0.08) video.currentTime = next;
    void video.play().catch(() => undefined);
  }, [props.playing, props.source]);

  useEffect(() => {
    if (props.playing) return;
    const video = videoRef.current;
    if (!video || !props.source) return;
    const duration = Math.max(0, props.source.fileDuration - 0.04);
    const next = Math.min(Math.max(0, target), duration);
    if (Math.abs(video.currentTime - next) > 0.03) video.currentTime = next;
  }, [props.playing, props.source, target]);

  return (
    <div
      className={cn('absolute inset-0 origin-center overflow-hidden', props.className)}
      style={{
        opacity: props.layer.opacity,
        transform: `scale(${props.layer.scale})`,
        willChange: 'opacity, transform',
      }}
    >
      {props.source ? (
        <video
          ref={videoRef}
          src={props.source.url}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div
          className={cn(
            'absolute inset-0',
            role === 'master' &&
              'bg-[radial-gradient(ellipse_at_30%_20%,#b45309,transparent_50%),linear-gradient(180deg,#1c1917,#78350f)]',
            role === 'side' &&
              'bg-[radial-gradient(ellipse_at_70%_80%,#0ea5e9,transparent_45%),linear-gradient(180deg,#020617,#1e293b)]',
            role === 'food' &&
              'bg-[radial-gradient(ellipse_at_50%_40%,#fb7185,transparent_40%),linear-gradient(180deg,#431407,#9a3412)]',
            role === 'ambience' &&
              'bg-[radial-gradient(ellipse_at_50%_10%,#34d399,transparent_40%),linear-gradient(180deg,#022c22,#115e59)]',
          )}
        />
      )}
      {!props.source && role === 'food' ? (
        <div className="absolute left-1/2 top-[42%] size-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-white/10 shadow-[0_0_40px_rgba(255,255,255,0.15)]" />
      ) : null}
      {!props.source && role === 'ambience' ? (
        <>
          <div className="absolute left-[18%] top-[12%] size-2 rounded-full bg-amber-200/80 blur-[1px]" />
          <div className="absolute left-[48%] top-[10%] size-2 rounded-full bg-amber-100/90 blur-[1px]" />
          <div className="absolute left-[76%] top-[14%] size-2 rounded-full bg-amber-200/70 blur-[1px]" />
        </>
      ) : null}
      {!props.source && role === 'side' ? (
        <div className="absolute bottom-[22%] left-[12%] right-[12%] h-16 rounded-sm bg-slate-400/20 ring-1 ring-white/10" />
      ) : null}
      {!props.source && role === 'master' ? (
        <div className="absolute bottom-[18%] left-[8%] right-[8%] h-10 rounded-sm bg-amber-950/50 ring-1 ring-amber-200/20" />
      ) : null}
      {props.chrome !== false && props.layer.opacity > 0.65 ? (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-4 pt-10">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">{label}</p>
          <p className="font-heading text-lg font-semibold text-white">{props.layer.beat.name}</p>
          <p className="truncate text-[11px] text-white/75">
            {props.source?.name ?? props.layer.beat.reason}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function FieldSelect<T extends string>(props: {
  value: T;
  items: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={props.value}
      onValueChange={(value) => props.onChange(value as T)}
      disabled={props.disabled}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function effectIsActive(effect: CatalogEffect, beat: PlaybookBeat, spec: ProgramPresetSpec) {
  return Boolean(
    (effect.apply?.join && effect.apply.join === beat.join) ||
    (effect.apply?.motion &&
      effect.apply.motion === (beat.motion ?? 'none') &&
      !effect.apply.punchIn) ||
    (effect.id === 'punch' && beat.motion === 'punch') ||
    (effect.id === 'punch-in' && beat.punchIn) ||
    (effect.id === 'fade-in' && beat.fadeIn) ||
    (effect.id === 'fade-out' && beat.fadeOut) ||
    (effect.id === 'prefer-peak' && beat.preferPeak !== false) ||
    (effect.id === 'captions-full' && spec.captions.strategy === 'full') ||
    (effect.id === 'captions-none' && spec.captions.strategy === 'none') ||
    (effect.apply?.joinOverlay && (beat.joinOverlay ?? 'none') === effect.apply.joinOverlay),
  );
}

function TransportButton(props: {
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant={props.active ? 'default' : 'outline'}
      disabled={props.disabled}
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
      className="size-9"
    >
      {props.children}
    </Button>
  );
}

function seekFromEvent(el: HTMLElement, clientX: number, duration: number) {
  const rect = el.getBoundingClientRect();
  const ratio = rect.width <= 0 ? 0 : (clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(duration, ratio * duration));
}

export default function AdminProgramNle(props: {
  spec: ProgramPresetSpec;
  catalog: CatalogEffect[];
  selected: number;
  canUndo: boolean;
  canRedo: boolean;
  onSelect: (index: number) => void;
  onChange: (spec: ProgramPresetSpec, options?: { history?: SpecHistoryMode }) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const { spec, selected, catalog, canUndo, canRedo, onSelect, onChange, onUndo, onRedo } = props;
  const beat = spec.beats[selected] ?? spec.beats[0]!;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [sources, setSources] = useState<Record<number, TakeSource>>({});
  const [dropOver, setDropOver] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const timeRef = useRef(0);
  const specRef = useRef(spec);
  const selectedRef = useRef(selected);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  timeRef.current = time;
  specRef.current = spec;
  selectedRef.current = selected;

  const capacity = useMemo(() => programCapacity(spec), [spec]);
  const { clips, duration } = useMemo(
    () => ({ clips: capacity.clips, duration: capacity.duration }),
    [capacity],
  );
  const overlayHits = useMemo(() => joinOverlayHits(spec), [spec]);
  const frame = useMemo(() => previewAtTime(spec, time), [spec, time]);
  const canCut = canSplitAt(spec, time);

  const clampTime = useCallback(
    (value: number) => Math.max(0, Math.min(duration, value)),
    [duration],
  );

  useEffect(() => {
    setTime(0);
    setPlaying(false);
    setSources((current) => {
      const urls = new Set(Object.values(current).map((item) => item.url));
      urls.forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
  }, [spec.program]);

  useEffect(() => {
    return () => {
      const urls = new Set(Object.values(sourcesRef.current).map((item) => item.url));
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    setTime((current) => Math.min(current, duration));
  }, [duration]);

  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((current) => {
        const next = current + dt;
        if (next >= duration) {
          if (loop && duration > 0) return 0;
          setPlaying(false);
          return duration;
        }
        return next;
      });
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing, duration, loop]);

  useEffect(() => {
    if (!playing) return;
    const clip = clipAtTime(clips, time);
    if (clip && clip.index !== selected) onSelect(clip.index);
  }, [playing, time, clips, selected, onSelect]);

  const seek = useCallback(
    (value: number, pause = true) => {
      if (pause) setPlaying(false);
      const next = clampTime(value);
      setTime(next);
      const clip = clipAtTime(clips, next);
      if (clip) onSelect(clip.index);
    },
    [clampTime, clips, onSelect],
  );

  const selectTake = useCallback(
    (index: number) => {
      onSelect(index);
      const clip = clips[index];
      if (clip) {
        setPlaying(false);
        setTime(clip.start);
      }
    },
    [clips, onSelect],
  );

  const patchBeat = useCallback(
    (partial: Partial<PlaybookBeat>, history: SpecHistoryMode = 'push') => {
      onChange(
        {
          ...spec,
          beats: spec.beats.map((item, index) =>
            index === selected ? { ...item, ...partial } : item,
          ),
        },
        { history },
      );
    },
    [onChange, spec, selected],
  );

  const applyEffect = useCallback(
    (effect: CatalogEffect) => {
      if (effect.status !== 'real') return;
      if (effect.id === 'captions-full') {
        onChange({ ...spec, captions: { strategy: 'full' } });
        return;
      }
      if (effect.id === 'captions-none') {
        onChange({ ...spec, captions: { strategy: 'none' } });
        return;
      }
      if (effect.apply) patchBeat(effect.apply);
    },
    [patchBeat, onChange, spec],
  );

  const remapSources = useCallback(
    (updater: (current: Record<number, TakeSource>) => Record<number, TakeSource>) => {
      setSources((current) => updater(current));
    },
    [],
  );

  const cutAtPlayhead = useCallback(() => {
    const next = splitSpecAtPlayhead(spec, time);
    if (!next) return;
    const clip = clipAtTime(clips, time);
    const local = clip ? time - clip.start : 0;
    const index = clip?.index ?? selected;
    remapSources((current) => {
      const shifted: Record<number, TakeSource> = {};
      for (const [key, value] of Object.entries(current)) {
        const itemIndex = Number(key);
        shifted[itemIndex > index ? itemIndex + 1 : itemIndex] = value;
      }
      const left = current[index];
      if (left) {
        shifted[index] = left;
        shifted[index + 1] = {
          ...left,
          id: crypto.randomUUID(),
          offsetSeconds: left.offsetSeconds + Math.max(0, local),
        };
      }
      return shifted;
    });
    onChange(next);
  }, [clips, onChange, remapSources, selected, spec, time]);

  async function attachFiles(fileList: FileList | File[] | null) {
    const files = [...(fileList ?? [])].filter(
      (file) => file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name),
    );
    if (!files.length) return;
    const prepared = await Promise.all(
      files.map(async (file) => ({
        id: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        name: file.name,
        fileDuration: await readVideoDuration(file),
        offsetSeconds: 0,
      })),
    );
    setSources((current) => {
      const next = { ...current };
      prepared.forEach((source, offset) => {
        const index = Math.min(spec.beats.length - 1, selected + offset);
        const previous = next[index];
        if (previous) revokeUnused(previous.url, { ...next, [index]: source });
        next[index] = source;
      });
      return next;
    });
  }

  function clearSource(index: number) {
    setSources((current) => {
      const next = { ...current };
      const removed = next[index];
      delete next[index];
      if (removed) revokeUnused(removed.url, next);
      return next;
    });
  }

  function removeTakeAt(index: number) {
    if (spec.beats.length <= FACTORY_LIMITS.minTakes) return;
    onChange({ ...spec, beats: spec.beats.filter((_, item) => item !== index) });
    remapSources((current) => {
      const next: Record<number, TakeSource> = {};
      for (const [key, value] of Object.entries(current)) {
        const itemIndex = Number(key);
        if (itemIndex === index) continue;
        next[itemIndex > index ? itemIndex - 1 : itemIndex] = value;
      }
      const removed = current[index];
      if (removed) revokeUnused(removed.url, next);
      return next;
    });
    onSelect(Math.max(0, index - 1));
  }

  const cutAtPlayheadRef = useRef(cutAtPlayhead);
  const removeTakeAtRef = useRef(removeTakeAt);
  cutAtPlayheadRef.current = cutAtPlayhead;
  removeTakeAtRef.current = removeTakeAt;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest(
            "[data-slot='select-content'], [data-slot='select-trigger'], [data-slot='dialog-content']",
          ))
      )
        return;
      const currentSpec = specRef.current;
      const currentSelected = selectedRef.current;
      const currentTime = timeRef.current;
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) onRedo();
          else onUndo();
        }
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (event.key === 'c' || event.key === 'C') {
        event.preventDefault();
        cutAtPlayheadRef.current();
      } else if (event.key === 'Home') {
        event.preventDefault();
        const clip = clips[currentSelected];
        seek(clip?.start ?? 0);
      } else if (event.key === 'End') {
        event.preventDefault();
        seek(duration);
      } else if (event.key === 'ArrowLeft' && event.shiftKey) {
        event.preventDefault();
        selectTake(Math.max(0, currentSelected - 1));
      } else if (event.key === 'ArrowRight' && event.shiftKey) {
        event.preventDefault();
        selectTake(Math.min(currentSpec.beats.length - 1, currentSelected + 1));
      } else if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'j') {
        event.preventDefault();
        seek(currentTime - 1);
      } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'l') {
        event.preventDefault();
        seek(currentTime + 1);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeTakeAtRef.current(currentSelected);
      } else if (event.key === 'k' || event.key === 'K') {
        event.preventDefault();
        setPlaying(false);
        setTime(0);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clips, duration, onRedo, onUndo, seek, selectTake]);

  const groups = useMemo(() => {
    const real = new Map<string, CatalogEffect[]>();
    const architecture: CatalogEffect[] = [];
    for (const effect of catalog) {
      if (effect.status !== 'real') {
        architecture.push(effect);
        continue;
      }
      const list = real.get(effect.group) ?? [];
      list.push(effect);
      real.set(effect.group, list);
    }
    return { real: [...real.entries()], architecture };
  }, [catalog]);

  const playheadPct = duration > 0 ? (time / duration) * 100 : 0;

  function onTimelinePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!timelineRef.current) return;
    dragging.current = true;
    timelineRef.current.setPointerCapture(event.pointerId);
    seek(seekFromEvent(timelineRef.current, event.clientX, duration));
  }

  function onTimelineMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current || !timelineRef.current) return;
    seek(seekFromEvent(timelineRef.current, event.clientX, duration));
  }

  function onTimelineUp() {
    dragging.current = false;
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
        multiple
        className="hidden"
        onChange={(event) => {
          void attachFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <div className="rounded-xl border bg-card px-3 py-2">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Efeitos da fábrica
          </p>
          <p className="text-[11px] text-muted-foreground">Só o que o FFmpeg queima no 1080×1920</p>
        </div>
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          {groups.real.map(([group, effects]) => (
            <div key={group} className="flex min-w-0 flex-wrap items-center gap-1">
              <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {groupLabels[group] ?? group}
              </span>
              {effects.map((effect) => {
                const active = effectIsActive(effect, beat, spec);
                return (
                  <button
                    key={effect.id}
                    type="button"
                    title={effect.hint}
                    onClick={() => applyEffect(effect)}
                    className={cn(
                      'rounded-md border px-2 py-0.5 text-xs hover:bg-accent',
                      active && 'border-primary bg-primary/10',
                    )}
                  >
                    {effect.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {groups.architecture.length ? (
          <details className="mt-2">
            <summary className="cursor-pointer select-none text-[11px] font-medium text-muted-foreground">
              Ainda não na fábrica ({groups.architecture.length})
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {groups.architecture.map((effect) => (
                <div
                  key={effect.id}
                  title={effect.hint}
                  className="cursor-not-allowed rounded-md border px-2 py-0.5 text-xs opacity-50"
                >
                  {effect.label}
                  <Badge variant="outline" className="ml-1">
                    ainda não
                  </Badge>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col items-center gap-2">
          <div
            className={cn(
              'relative aspect-[9/16] w-full max-h-[min(42vh,420px)] max-w-[260px] overflow-hidden rounded-2xl border bg-black shadow-card',
              dropOver && 'ring-2 ring-primary',
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDropOver(true);
            }}
            onDragLeave={() => setDropOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDropOver(false);
              void attachFiles(event.dataTransfer.files);
            }}
          >
            {frame ? (
              <>
                {clips.map((clip) => {
                  const isOutgoing = clip.index === frame.outgoing.clipIndex;
                  const isIncoming = clip.index === frame.incoming?.clipIndex;
                  const isNext = clip.index === frame.outgoing.clipIndex + 1;
                  if (!isOutgoing && !isIncoming && !isNext) return null;
                  const local = localTimeInClip(clip, time);
                  const layer = isOutgoing
                    ? frame.outgoing
                    : isIncoming && frame.incoming
                      ? frame.incoming
                      : {
                          clipIndex: clip.index,
                          localTime: local,
                          scale: beatScale(clip.beat, local),
                          opacity: 0,
                          beat: clip.beat,
                        };
                  return (
                    <ScenePlate
                      key={clip.index}
                      layer={layer}
                      source={sources[clip.index]}
                      playing={playing && layer.opacity > 0.02}
                      chrome={isOutgoing && !frame.inOverlap}
                    />
                  );
                })}
                {frame.fadeBlack > 0 ? (
                  <div className="absolute inset-0 bg-black" style={{ opacity: frame.fadeBlack }} />
                ) : null}
                {frame.joinOverlay && frame.joinOverlay.opacity > 0 ? (
                  <div
                    className="pointer-events-none absolute inset-0 mix-blend-screen"
                    style={{
                      opacity: frame.joinOverlay.opacity,
                      background: JOIN_OVERLAY[frame.joinOverlay.name].preview,
                    }}
                  />
                ) : null}
                {frame.programFade > 0 ? (
                  <div
                    className="absolute inset-0 bg-black"
                    style={{ opacity: frame.programFade }}
                  />
                ) : null}
                {frame.captionVisible ? (
                  <div className="absolute inset-x-4 top-[18%] rounded-md bg-black/55 px-2 py-1 text-center text-[11px] font-medium text-white">
                    Legenda do turno · queima 8s no ASS
                  </div>
                ) : null}
                <div className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
                  {formatTimecode(time)}
                </div>
                <div className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/80">
                  1080×1920 · {playing ? 'play' : 'pause'}
                </div>
                {frame.inOverlap || frame.joinOverlay ? (
                  <div className="absolute bottom-14 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    {joinLabels[frame.incoming?.beat.join ?? beat.join]}
                    {frame.joinOverlay ? ` · ${joinOverlayLabels[frame.joinOverlay.name]}` : ''}
                  </div>
                ) : null}
                {!sources[selected] ? (
                  <div className="pointer-events-none absolute inset-x-3 bottom-16 z-10 rounded-md bg-black/55 px-3 py-2 text-center text-xs text-white/80">
                    Solte um MP4 aqui
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          <p className="max-w-[18rem] text-center text-[11px] text-muted-foreground">
            Punch 11% · drift 7% · fade in 0,7s · fade out 0,85s. Flash/leak/burn no meio do join,
            por cima do xfade.
          </p>
        </div>

        <Card className="max-h-[min(42vh,420px)] overflow-y-auto">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Take {selected + 1}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <Label>Arquivo deste take</Label>
              {sources[selected] ? (
                <div className="space-y-2">
                  <p className="truncate text-sm font-medium">{sources[selected]!.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {sources[selected]!.fileDuration.toFixed(1)}s no disco
                  </p>
                  <label className="block space-y-1 text-sm">
                    <Label>In-point (s)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={Math.max(
                        0,
                        sources[selected]!.fileDuration - FACTORY_LIMITS.minBeatSeconds,
                      )}
                      step={0.1}
                      value={Number(sources[selected]!.offsetSeconds.toFixed(2))}
                      onChange={(event) => {
                        const offsetSeconds = Math.max(0, Number(event.target.value));
                        setSources((current) =>
                          current[selected]
                            ? { ...current, [selected]: { ...current[selected]!, offsetSeconds } }
                            : current,
                        );
                      }}
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Trocar arquivo
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => clearSource(selected)}
                    >
                      <X className="mr-1 size-3.5" />
                      Tirar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FilePlus2 className="mr-1.5 size-3.5" />
                  Anexar a este take
                </Button>
              )}
            </div>
            <label className="block space-y-1 text-sm">
              <Label>Nome</Label>
              <Input
                value={beat.name}
                onChange={(event) => patchBeat({ name: event.target.value }, 'coalesce')}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <Label>Tempo do take / Pulso (s)</Label>
              <Input
                type="number"
                min={FACTORY_LIMITS.minBeatSeconds}
                max={FACTORY_LIMITS.maxBeatSeconds}
                step={0.1}
                value={beat.durationSeconds}
                onChange={(event) =>
                  patchBeat({ durationSeconds: Number(event.target.value) }, 'coalesce')
                }
              />
            </label>
            <div className="space-y-1 text-sm">
              <Label>Transição à entrada</Label>
              <FieldSelect
                value={beat.join}
                items={joins.map((join) => ({ value: join, label: joinLabels[join] }))}
                onChange={(join) =>
                  patchBeat({ join, joinDurationSeconds: JOIN_DEFAULT_SECONDS[join] })
                }
              />
            </div>
            <label className="block space-y-1 text-sm">
              <Label>Tempo da transição (s)</Label>
              <Input
                type="number"
                min={beat.join === 'cut' ? 0.02 : 0.4}
                max={1.5}
                step={0.02}
                placeholder={`${JOIN_DEFAULT_SECONDS[beat.join]}`}
                value={beat.joinDurationSeconds ?? ''}
                onChange={(event) =>
                  patchBeat(
                    {
                      joinDurationSeconds:
                        event.target.value === '' ? undefined : Number(event.target.value),
                    },
                    'coalesce',
                  )
                }
              />
            </label>
            <div className="space-y-1 text-sm">
              <Label>Overlay no join</Label>
              <FieldSelect
                value={beat.joinOverlay ?? 'none'}
                items={overlays.map((overlay) => ({
                  value: overlay,
                  label: joinOverlayLabels[overlay],
                }))}
                onChange={(joinOverlay) => patchBeat({ joinOverlay })}
              />
              <p className="text-[11px] text-muted-foreground">
                {selected === 0
                  ? 'Não há transição à entrada do primeiro take.'
                  : 'Transparente, no meio do cut/dissolve. Pack WebM/MOV com alpha ainda não entra na fábrica.'}
              </p>
            </div>
            <div className="space-y-1 text-sm">
              <Label>Motion</Label>
              <FieldSelect
                value={beat.motion ?? 'none'}
                items={motions.map((motion) => ({ value: motion, label: motionLabels[motion] }))}
                onChange={(motion) => patchBeat({ motion })}
              />
            </div>
            <div className="space-y-1">
              <Label>Câmeras</Label>
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => {
                  const on = beat.roles.includes(role);
                  return (
                    <Button
                      key={role}
                      type="button"
                      size="sm"
                      variant={on ? 'default' : 'outline'}
                      onClick={() => {
                        const next = on
                          ? beat.roles.filter((item) => item !== role)
                          : [...beat.roles, role];
                        patchBeat({ roles: next.length ? next : [role] });
                      }}
                    >
                      {cameraRoleLabels[role]}
                    </Button>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center justify-between text-sm">
              Punch-in{' '}
              <Switch
                checked={Boolean(beat.punchIn)}
                onCheckedChange={(value) => patchBeat({ punchIn: value })}
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              Fade in{' '}
              <Switch
                checked={Boolean(beat.fadeIn)}
                onCheckedChange={(value) => patchBeat({ fadeIn: value })}
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              Fade out{' '}
              <Switch
                checked={Boolean(beat.fadeOut)}
                onCheckedChange={(value) => patchBeat({ fadeOut: value })}
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              Cortar no pico{' '}
              <Switch
                checked={beat.preferPeak !== false}
                onCheckedChange={(value) => patchBeat({ preferPeak: value })}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <Label>Por que este take</Label>
              <Input
                value={beat.reason}
                onChange={(event) => patchBeat({ reason: event.target.value }, 'coalesce')}
              />
            </label>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <TransportButton
          label="Take anterior / início do take"
          onClick={() => {
            const clip = clipAtTime(clips, time);
            if (!clip) return;
            if (time - clip.start < 0.15 && clip.index > 0) selectTake(clip.index - 1);
            else selectTake(clip.index);
          }}
        >
          <SkipBack className="size-4" />
        </TransportButton>
        <TransportButton label="Recuar 1s" onClick={() => seek(time - 1)}>
          <ChevronLeft className="size-4" />
        </TransportButton>
        <TransportButton
          label={playing ? 'Pausar' : 'Reproduzir'}
          active={playing}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </TransportButton>
        <TransportButton
          label="Parar"
          onClick={() => {
            setPlaying(false);
            setTime(0);
          }}
        >
          <Square className="size-4" />
        </TransportButton>
        <TransportButton label="Avançar 1s" onClick={() => seek(time + 1)}>
          <ChevronRight className="size-4" />
        </TransportButton>
        <TransportButton
          label="Take seguinte"
          onClick={() => selectTake(Math.min(spec.beats.length - 1, selected + 1))}
        >
          <SkipForward className="size-4" />
        </TransportButton>
        <TransportButton
          label="Repetir programa"
          active={loop}
          onClick={() => setLoop((value) => !value)}
        >
          <Repeat className="size-4" />
        </TransportButton>
        <Button
          type="button"
          size="sm"
          disabled={!canCut}
          onClick={cutAtPlayhead}
          title="Cortar no playhead (C)"
        >
          <Scissors className="mr-1.5 size-3.5" />
          Cortar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
        >
          <FilePlus2 className="mr-1.5 size-3.5" />
          Adicionar arquivo
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="mr-1.5 size-3.5" />
          Desfazer
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="mr-1.5 size-3.5" />
          Refazer
        </Button>
        <p className="ml-auto font-mono text-xs text-muted-foreground">
          {formatTimecode(time)} / {formatTimecode(duration)}
        </p>
      </div>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.01}
        value={Math.min(time, duration)}
        aria-label="Playhead"
        className="w-full accent-primary"
        onChange={(event) => seek(Number(event.target.value))}
      />
      <p className="text-[11px] text-muted-foreground">
        Espaço play/pause · C cortar · ←/→ 1s · Shift+setas take · J/L 1s · K parar · Delete remove
        · cada lado do corte precisa de 0,8s.
      </p>

      <div
        ref={timelineRef}
        className="select-none rounded-xl border bg-muted/30 p-3"
        onPointerDown={onTimelinePointer}
        onPointerMove={onTimelineMove}
        onPointerUp={onTimelineUp}
        onPointerCancel={onTimelineUp}
      >
        <div className="relative mb-2 h-4">
          {Array.from({ length: Math.floor(duration) + 1 }, (_, second) => (
            <span
              key={second}
              className="absolute top-0 -translate-x-1/2 font-mono text-[9px] text-muted-foreground"
              style={{ left: `${duration > 0 ? (second / duration) * 100 : 0}%` }}
            >
              {second}s
            </span>
          ))}
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Vídeo · {spec.beats.length} takes
        </p>
        <div className="relative h-24 overflow-hidden rounded-md bg-background">
          {clips.map((clip) => (
            <div
              key={`${clip.beat.name}-${clip.index}`}
              title={`${clip.beat.name} · ${clip.duration.toFixed(1)}s · ${cameraRoleLabels[roleOf(clip.beat)]}`}
              style={{
                left: `${duration > 0 ? (clip.start / duration) * 100 : 0}%`,
                width: `${duration > 0 ? (clip.duration / duration) * 100 : 0}%`,
              }}
              className={cn(
                'pointer-events-none absolute top-1 bottom-1 overflow-hidden rounded border text-left text-[10px] font-medium text-white',
                roleTone[roleOf(clip.beat)],
                selected === clip.index
                  ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                  : 'opacity-90',
              )}
            >
              <span className="block truncate px-1.5 pt-1.5">{clip.beat.name}</span>
              <span className="block truncate px-1.5 opacity-85">
                {cameraRoleLabels[roleOf(clip.beat)]}
              </span>
              <span className="block truncate px-1.5 opacity-75">
                {sources[clip.index]?.name ?? `${clip.duration.toFixed(1)}s`}
              </span>
            </div>
          ))}
          {clips.slice(1).map((clip) => (
            <div
              key={`join-${clip.index}`}
              title={`${joinLabels[clip.beat.join]} ${clip.joinOverlap.toFixed(2)}s`}
              className="absolute top-0 h-full w-0.5 bg-white/90"
              style={{ left: `${duration > 0 ? (clip.start / duration) * 100 : 0}%` }}
            />
          ))}
          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-red-500"
            style={{ left: `${playheadPct}%` }}
          />
        </div>
        <p className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          FX no join · overlay transparente
        </p>
        <div className="relative h-8 overflow-hidden rounded-md bg-background">
          {overlayHits.length ? (
            overlayHits.map((hit) => (
              <div
                key={`fx-${hit.clipIndex}`}
                title={`${joinOverlayLabels[hit.name]} ${hit.duration.toFixed(2)}s no meio do join`}
                className={cn(
                  'absolute inset-y-1 overflow-hidden rounded border px-1 text-[10px] font-medium text-white',
                  hit.name === 'flash' && 'border-white/40 bg-white/70 text-black',
                  hit.name === 'leak' && 'border-orange-300/50 bg-orange-400/70',
                  hit.name === 'burn' && 'border-amber-200/50 bg-amber-500/80',
                )}
                style={{
                  left: `${duration > 0 ? (hit.start / duration) * 100 : 0}%`,
                  width: `${duration > 0 ? Math.max(1.2, (hit.duration / duration) * 100) : 0}%`,
                }}
              >
                {joinOverlayLabels[hit.name]}
              </div>
            ))
          ) : (
            <p className="px-2 py-1.5 text-[10px] text-muted-foreground">
              {selected === 0
                ? 'O take 1 não tem join. Selecione o take seguinte e ponha Flash, Leak ou Burn.'
                : 'Flash, leak ou burn neste take — sentam-se no meio da transição, por cima do xfade.'}
            </p>
          )}
          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-red-500"
            style={{ left: `${playheadPct}%` }}
          />
        </div>
        <p className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Legendas
        </p>
        <div className="relative h-7 overflow-hidden rounded-md bg-background">
          {spec.captions.strategy === 'full' ? (
            <div
              className="absolute inset-y-1 rounded bg-primary/40"
              style={{
                width: `${duration > 0 ? (Math.min(FACTORY_LIMITS.captionSeconds, duration) / duration) * 100 : 0}%`,
              }}
            />
          ) : (
            <p className="px-2 py-1 text-[10px] text-muted-foreground">
              Desligadas — o worker não queima ASS
            </p>
          )}
          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-red-500"
            style={{ left: `${playheadPct}%` }}
          />
        </div>
        <p className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Áudio da fábrica
        </p>
        <div className="relative h-7 overflow-hidden rounded-md bg-background">
          <div
            className="absolute inset-y-1 left-0 rounded-l bg-sky-400/30"
            style={{
              width: `${duration > 0 ? (FACTORY_LIMITS.audioFadeInSeconds / duration) * 100 : 0}%`,
            }}
          />
          <div
            className="absolute inset-y-1 rounded-r bg-sky-400/30"
            style={{
              left: `${duration > 0 ? ((duration - FACTORY_LIMITS.audioFadeOutSeconds) / duration) * 100 : 0}%`,
              width: `${duration > 0 ? (FACTORY_LIMITS.audioFadeOutSeconds / duration) * 100 : 0}%`,
            }}
          />
          <p className="relative px-2 py-1 text-[10px] text-muted-foreground">
            fade 0,55s / 0,8s · loudnorm · não editável aqui
          </p>
          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-red-500"
            style={{ left: `${playheadPct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={spec.beats.length >= FACTORY_LIMITS.maxTakes}
          onClick={() => {
            onChange({ ...spec, beats: [...spec.beats, emptyBeat(spec.beats.length)] });
            onSelect(spec.beats.length);
          }}
        >
          Adicionar take
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={spec.beats.length <= FACTORY_LIMITS.minTakes}
          onClick={() => removeTakeAt(selected)}
        >
          Remover
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={spec.beats.length >= FACTORY_LIMITS.maxTakes}
          onClick={() => {
            const next = duplicateBeatAt(spec, selected);
            if (!next) return;
            remapSources((current) => {
              const shifted: Record<number, TakeSource> = {};
              for (const [key, value] of Object.entries(current)) {
                const itemIndex = Number(key);
                shifted[itemIndex > selected ? itemIndex + 1 : itemIndex] = value;
              }
              const copy = current[selected];
              if (copy) shifted[selected + 1] = { ...copy, id: crypto.randomUUID() };
              return shifted;
            });
            onChange(next);
            onSelect(selected + 1);
          }}
        >
          <Copy className="mr-1.5 size-3.5" />
          Duplicar
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={selected === 0}
          onClick={() => {
            remapSources((current) => {
              const next = { ...current };
              const left = next[selected - 1];
              const right = next[selected];
              if (right) next[selected - 1] = right;
              else delete next[selected - 1];
              if (left) next[selected] = left;
              else delete next[selected];
              return next;
            });
            onChange(moveBeat(spec, selected, -1));
            onSelect(selected - 1);
          }}
        >
          Mover ←
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={selected >= spec.beats.length - 1}
          onClick={() => {
            remapSources((current) => {
              const next = { ...current };
              const left = next[selected];
              const right = next[selected + 1];
              if (left) next[selected + 1] = left;
              else delete next[selected + 1];
              if (right) next[selected] = right;
              else delete next[selected];
              return next;
            });
            onChange(moveBeat(spec, selected, 1));
            onSelect(selected + 1);
          }}
        >
          Mover →
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Capacidade desta fábrica</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <CapacityStat
              label="Takes"
              value={`${capacity.takeCount} / ${FACTORY_LIMITS.maxTakes}`}
              hint="mín. 3 · máx. 12"
            />
            <CapacityStat
              label="Duração montada"
              value={`${capacity.duration.toFixed(1)}s`}
              hint={`alvo ${capacity.target}s · nominais ${capacity.nominal.toFixed(1)}s`}
            />
            <CapacityStat
              label="Overlap dos joins"
              value={`${capacity.overlapSaved.toFixed(2)}s`}
              hint="cortes secos quase não comem tempo"
            />
            <CapacityStat
              label="Comida / ofício"
              value={`${Math.round(capacity.foodShare * 100)}% / ${Math.round(capacity.kitchenShare * 100)}%`}
              hint={`papéis ${capacity.roles.map((role) => cameraRoleLabels[role]).join(', ') || '—'}`}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            1 FFmpeg de cada vez neste KVM. Ken Burns (drift/punch) só no perfil HIGH. Título, logo,
            CTA e end card não entram neste render.
          </p>
          {capacity.warnings.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-warning">
              {capacity.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Dentro do que a fábrica consegue publicar neste padrão.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1 text-sm">
              <Label>Join padrão do programa</Label>
              <FieldSelect
                value={spec.join}
                items={[
                  { value: 'cut' as const, label: 'Corte seco' },
                  { value: 'dissolve' as const, label: 'Dissolve' },
                ]}
                onChange={(join) => onChange({ ...spec, join })}
              />
            </div>
            <label className="space-y-1 text-sm">
              <Label>Duração alvo (s)</Label>
              <Input
                type="number"
                min={8}
                max={45}
                step={0.5}
                value={spec.targetDuration}
                onChange={(event) =>
                  onChange(
                    { ...spec, targetDuration: Number(event.target.value) },
                    { history: 'coalesce' },
                  )
                }
              />
            </label>
            <div className="space-y-1 text-sm">
              <Label>Legenda</Label>
              <FieldSelect
                value={spec.captions.strategy}
                items={[
                  { value: 'full' as const, label: 'Queimar caption da visão' },
                  { value: 'none' as const, label: 'Sem legenda' },
                ]}
                onChange={(strategy) => onChange({ ...spec, captions: { strategy } })}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CapacityStat(props: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {props.label}
      </p>
      <p className="font-heading text-lg font-semibold">{props.value}</p>
      <p className="text-[11px] text-muted-foreground">{props.hint}</p>
    </div>
  );
}
