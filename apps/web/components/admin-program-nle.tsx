'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePlus2,
  Minus,
  Plus,
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
  emptyProgramBranding,
  FACTORY_BRANDING,
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
  programBrandCopy,
  programCapacity,
  splitSpecAtPlayhead,
  snapTime,
  clampBeatDuration,
  type CameraRole,
  type CatalogEffect,
  type FxAsset,
  type JoinName,
  type JoinOverlayKind,
  type JoinOverlayName,
  type MotionName,
  type PlaybookBeat,
  type PreviewLayer,
  type ProgramPresetSpec,
} from '@reelops/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
        filter: 'contrast(1.08) brightness(1.028) saturate(1.14)',
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
        <div className="absolute inset-x-0 top-28 px-12">
          <p
            className="font-bold uppercase tracking-[0.18em] text-white/70"
            style={{ fontSize: 28 }}
          >
            {label}
          </p>
          <p className="font-heading font-semibold text-white" style={{ fontSize: 56 }}>
            {props.layer.beat.name}
          </p>
          <p className="truncate text-white/75" style={{ fontSize: 32 }}>
            {props.source?.name ?? props.layer.beat.reason}
          </p>
        </div>
      ) : null}
      <div
        className="pointer-events-none absolute inset-0 mix-blend-soft-light"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,176,80,0.16) 0%, transparent 38%, rgba(18,36,72,0.2) 100%)',
        }}
      />
    </div>
  );
}

function JoinFxPlate(props: { name: JoinOverlayKind; opacity: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 mix-blend-screen"
      style={{ opacity: props.opacity, background: JOIN_OVERLAY[props.name].preview }}
    >
      {props.name === 'leak' ? (
        <div className="absolute -left-[20%] -top-[18%] h-[70%] w-[75%] rounded-full bg-[#ffb060]/40 blur-2xl" />
      ) : null}
      {props.name === 'burn' ? (
        <div className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-amber-100/70 to-transparent" />
      ) : null}
    </div>
  );
}

function NleLookTutorial({ takeIndex, packCount }: { takeIndex: number; packCount: number }) {
  const first = takeIndex === 0;
  return (
    <section className="space-y-3 border-t border-[#262d3a] px-3 py-3 text-[12px] leading-snug text-[#8a94a7]">
      <h3 className="text-sm font-semibold text-[#e8eef6]">Tutorial do look</h3>
      <p className="text-[#e8eef6]">
        O monitor à esquerda é o Reel 9:16. A coluna do meio edita o take selecionado. A linha de
        baixo é a timeline.
      </p>
      <ol className="list-decimal space-y-2.5 pl-4">
        <li>
          Clique num bloco na linha <span className="font-medium text-[#e8eef6]">V1</span> (Sala,
          Balcão, Prato…). Esse é o take que o painel do meio está a editar.
        </li>
        <li>
          <span className="font-medium text-[#e8eef6]">Transição à entrada</span> — como este take
          entra por cima do anterior.
          {first ? (
            <> O take 1 não tem entrada: o filme começa nele.</>
          ) : (
            <> Corte seco, dissolve ou fade a preto. O tempo (0,4–1,2s) é o cruzamento.</>
          )}
        </li>
        <li>
          <span className="font-medium text-[#e8eef6]">Overlay no join</span> — flash, leak ou burn
          gerados (uma cor no meio do corte). Aparece na linha{' '}
          <span className="font-medium text-[#e8eef6]">FX</span>. Não é o pack WebM.
        </li>
        <li>
          <span className="font-medium text-[#e8eef6]">Pack FX</span> — ficheiro WebM com
          transparência (wipe, blur, flare). {packCount} no catálogo.{' '}
          <span className="text-[#e8eef6]">Auto</span> = a OpenAI escolhe um id.{' '}
          <span className="text-[#e8eef6]">Sem pack</span> = nenhum. Travar um id = você manda.
        </li>
        <li>
          Não ponha pack em todos os cortes. Pulso: 1–2 transições. Casa: 1 join + 1 lens, sem
          smash. O primeiro take pode levar lens no prato, não wipe.
        </li>
        <li>
          Linhas da timeline: <span className="font-medium text-[#e8eef6]">V1</span> takes ·{' '}
          <span className="font-medium text-[#e8eef6]">FX</span> overlay no join ·{' '}
          <span className="font-medium text-[#e8eef6]">CC</span> legendas ·{' '}
          <span className="font-medium text-[#e8eef6]">A1</span> música. O pack WebM só queima no
          FFmpeg do worker — neste monitor vê-se o overlay de cor, não o ficheiro.
        </li>
        <li>
          Quando o look estiver certo, publique o programa. Os Reels do restaurante usam este
          playbook.
        </li>
      </ol>
    </section>
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
      <SelectTrigger className="h-8 w-full border-[#262d3a] bg-[#08090c] text-[12px]">
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
    (effect.apply?.joinOverlay && (beat.joinOverlay ?? 'none') === effect.apply.joinOverlay) ||
    (effect.applyBranding &&
      Object.entries(effect.applyBranding).every(
        ([key, value]) =>
          (spec.branding ?? emptyProgramBranding)[key as keyof typeof emptyProgramBranding] ===
          value,
      )),
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
    <button
      type="button"
      disabled={props.disabled}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active || undefined}
      onClick={props.onClick}
      className={cn('nle-icon', props.active && 'text-[#d4a24c]')}
    >
      {props.children}
    </button>
  );
}

function seekFromEvent(el: HTMLElement, clientX: number, duration: number) {
  const rect = el.getBoundingClientRect();
  const ratio = rect.width <= 0 ? 0 : (clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(duration, ratio * duration));
}

function PlayheadMark(props: { pct: number }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${props.pct}%` }}>
      <div className="-ml-[5px] h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-[#ff3d5a]" />
      <div className="ml-px h-full w-px bg-[#ff3d5a]" />
    </div>
  );
}

function ReelsStage(props: {
  dropOver: boolean;
  children: React.ReactNode;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () => {
      const rect = host.getBoundingClientRect();
      setScale(
        Math.max(
          0.08,
          Math.min(
            rect.width / FACTORY_LIMITS.frameWidth,
            rect.height / FACTORY_LIMITS.frameHeight,
          ),
        ),
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const width = FACTORY_LIMITS.frameWidth * scale;
  const height = FACTORY_LIMITS.frameHeight * scale;

  return (
    <div ref={hostRef} className="flex h-full min-h-0 w-full items-center justify-center p-3">
      <div
        role="img"
        aria-label="Monitor Reels 1080 por 1920"
        className={cn(
          'relative overflow-hidden bg-black shadow-[0_0_0_1px_#262d3a,0_24px_80px_rgba(0,0,0,0.55)]',
          props.dropOver && 'ring-2 ring-[#d4a24c]',
        )}
        style={{ width, height }}
        onDragOver={props.onDragOver}
        onDragLeave={props.onDragLeave}
        onDrop={props.onDrop}
      >
        <div
          className="absolute left-0 top-0 origin-top-left overflow-hidden"
          style={{
            width: FACTORY_LIMITS.frameWidth,
            height: FACTORY_LIMITS.frameHeight,
            transform: `scale(${scale})`,
          }}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
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
  const [fxAssets, setFxAssets] = useState<FxAsset[]>([]);
  const [dropOver, setDropOver] = useState(false);
  const [zoom, setZoom] = useState(1);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<
    | { kind: 'scrub' }
    | {
        kind: 'trim';
        index: number;
        edge: 'left' | 'right';
        startX: number;
        startDuration: number;
        startPrev?: number;
        startOffset: number;
      }
    | { kind: 'reorder'; index: number; startX: number }
    | null
  >(null);
  const timeRef = useRef(0);
  const specRef = useRef(spec);
  const selectedRef = useRef(selected);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  timeRef.current = time;
  specRef.current = spec;
  selectedRef.current = selected;

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/admin/fx-catalog', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { assets: [] }))
      .then((data) => {
        if (!cancelled && Array.isArray(data.assets)) setFxAssets(data.assets);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const capacity = useMemo(() => programCapacity(spec), [spec]);
  const { clips, duration } = useMemo(
    () => ({ clips: capacity.clips, duration: capacity.duration }),
    [capacity],
  );
  const overlayHits = useMemo(() => joinOverlayHits(spec), [spec]);
  const frame = useMemo(() => previewAtTime(spec, time), [spec, time]);
  const brandCopy = useMemo(
    () => programBrandCopy({ restaurantName: 'Nome do restaurante', program: spec.program }),
    [spec.program],
  );
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
    (value: number, pause = true, snap = false) => {
      if (pause) setPlaying(false);
      const raw = clampTime(value);
      const next = snap ? snapTime(specRef.current, raw, 0.12) : raw;
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
      const active = effectIsActive(effect, beat, spec);
      if (effect.applyBranding) {
        const next = { ...emptyProgramBranding, ...spec.branding };
        for (const [key, value] of Object.entries(effect.applyBranding)) {
          const field = key as keyof typeof next;
          next[field] = active ? false : Boolean(value);
        }
        onChange({ ...spec, branding: next });
        return;
      }
      if (active) {
        if (effect.id === 'captions-full') {
          onChange({ ...spec, captions: { strategy: 'none' } });
          return;
        }
        if (effect.id === 'captions-none') {
          onChange({ ...spec, captions: { strategy: 'full' } });
          return;
        }
        if (effect.id === 'fade-in') {
          patchBeat({ fadeIn: false });
          return;
        }
        if (effect.id === 'fade-out') {
          patchBeat({ fadeOut: false });
          return;
        }
        if (effect.id === 'punch-in') {
          patchBeat({ punchIn: false });
          return;
        }
        if (effect.id === 'prefer-peak') {
          patchBeat({ preferPeak: false });
          return;
        }
        if (effect.id === 'punch' || effect.id === 'drift') {
          patchBeat({ motion: 'none', punchIn: effect.id === 'punch' ? false : beat.punchIn });
          return;
        }
        if (effect.apply?.joinOverlay && effect.apply.joinOverlay !== 'none') {
          patchBeat({ joinOverlay: 'none' });
          return;
        }
        return;
      }
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
    [beat, patchBeat, onChange, spec],
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
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        setZoom((value) => Math.max(1, Number((value - 0.5).toFixed(1))));
      } else if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        setZoom((value) => Math.min(4, Number((value + 0.5).toFixed(1))));
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

  function secondsPerPixel() {
    const width = timelineRef.current?.getBoundingClientRect().width ?? 1;
    return duration / Math.max(1, width);
  }

  function onTimelinePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!timelineRef.current || dragRef.current) return;
    dragRef.current = { kind: 'scrub' };
    timelineRef.current.setPointerCapture(event.pointerId);
    seek(seekFromEvent(timelineRef.current, event.clientX, duration), true, true);
  }

  function onTimelineMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !timelineRef.current) return;
    if (drag.kind === 'scrub') {
      seek(seekFromEvent(timelineRef.current, event.clientX, duration), true, true);
      return;
    }
    const delta = (event.clientX - drag.startX) * secondsPerPixel();
    const current = specRef.current;
    if (drag.kind === 'trim') {
      if (drag.edge === 'right') {
        const next = clampBeatDuration(drag.startDuration + delta);
        onChange(
          {
            ...current,
            beats: current.beats.map((item, index) =>
              index === drag.index ? { ...item, durationSeconds: next } : item,
            ),
          },
          { history: 'coalesce' },
        );
        return;
      }
      if (drag.index > 0) {
        const next = clampBeatDuration((drag.startPrev ?? FACTORY_LIMITS.minBeatSeconds) + delta);
        onChange(
          {
            ...current,
            beats: current.beats.map((item, index) =>
              index === drag.index - 1 ? { ...item, durationSeconds: next } : item,
            ),
          },
          { history: 'coalesce' },
        );
        return;
      }
      const offsetSeconds = Math.max(0, drag.startOffset + delta);
      setSources((sources) =>
        sources[0] ? { ...sources, 0: { ...sources[0]!, offsetSeconds } } : sources,
      );
      onChange(
        {
          ...current,
          beats: current.beats.map((item, index) =>
            index === 0
              ? { ...item, durationSeconds: clampBeatDuration(drag.startDuration - delta) }
              : item,
          ),
        },
        { history: 'coalesce' },
      );
    }
  }

  function onTimelineUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.kind !== 'reorder' || !timelineRef.current) return;
    const width = timelineRef.current.getBoundingClientRect().width;
    const clip = clips[drag.index];
    if (!clip) return;
    const clipW = duration > 0 ? (clip.duration / duration) * width : width;
    const steps = Math.round((event.clientX - drag.startX) / Math.max(28, clipW));
    if (!steps) return;
    const dir = steps > 0 ? 1 : -1;
    let index = drag.index;
    let current = specRef.current;
    for (let step = 0; step < Math.abs(steps); step += 1) {
      const nextIndex = index + dir;
      if (nextIndex < 0 || nextIndex >= current.beats.length) break;
      remapSources((sources) => {
        const next = { ...sources };
        const left = next[index];
        const right = next[nextIndex];
        if (right) next[index] = right;
        else delete next[index];
        if (left) next[nextIndex] = left;
        else delete next[nextIndex];
        return next;
      });
      current = moveBeat(current, index, dir);
      index = nextIndex;
    }
    if (index !== drag.index) {
      onChange(current);
      onSelect(index);
    }
  }

  function beginClipDrag(event: React.PointerEvent, index: number, edge?: 'left' | 'right') {
    event.stopPropagation();
    event.preventDefault();
    timelineRef.current?.setPointerCapture(event.pointerId);
    const item = spec.beats[index];
    if (!item) return;
    if (edge) {
      dragRef.current = {
        kind: 'trim',
        index,
        edge,
        startX: event.clientX,
        startDuration: item.durationSeconds,
        startPrev: spec.beats[index - 1]?.durationSeconds,
        startOffset: sources[index]?.offsetSeconds ?? 0,
      };
      return;
    }
    dragRef.current = { kind: 'reorder', index, startX: event.clientX };
    onSelect(index);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
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

      <div className="nle-fxbar">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <p className="nle-kicker">Efeitos da fábrica</p>
          <p className="text-[11px] text-[#8a94a7]">
            Só o que o FFmpeg queima no 1080×1920. Nome e PNG vêm de cada restaurante.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {groups.real.map(([group, effects]) => (
            <div key={group} className="flex min-w-0 flex-wrap items-center gap-1">
              <span className="nle-kicker mr-1">{groupLabels[group] ?? group}</span>
              {effects.map((effect) => {
                const active = effectIsActive(effect, beat, spec);
                return (
                  <Tooltip key={effect.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => applyEffect(effect)}
                        className={cn('nle-chip', active && 'is-on')}
                      >
                        {effect.label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      {effect.hint}
                      {active ? ' · clique outra vez para tirar' : ''}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
        {groups.architecture.length ? (
          <details>
            <summary className="cursor-pointer select-none text-[11px] font-medium text-[#8a94a7]">
              Ainda não na fábrica ({groups.architecture.length})
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {groups.architecture.map((effect) => (
                <div
                  key={effect.id}
                  title={effect.hint}
                  className="nle-chip cursor-not-allowed opacity-50"
                >
                  {effect.label}
                  <Badge variant="outline" className="ml-1 border-[#262d3a] text-[9px]">
                    ainda não
                  </Badge>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-[#262d3a] bg-[#10131a]">
          <p className="nle-kicker px-3 py-2">Takes</p>
          <div className="nle-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
            {spec.beats.map((item, index) => (
              <button
                key={`${item.name}-${index}`}
                type="button"
                onClick={() => onSelect(index)}
                className={cn('nle-take', selected === index && 'is-active')}
              >
                <span className="block text-[11px] font-medium text-[#e8eef6]">
                  Take {index + 1} · {item.name}
                </span>
                <span className="mt-0.5 block text-[10px] text-[#8a94a7]">
                  {cameraRoleLabels[roleOf(item)]} · {item.durationSeconds.toFixed(1)}s
                </span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1 border-t border-[#262d3a] p-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-[#262d3a] bg-transparent text-[11px]"
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
              className="h-7 border-[#262d3a] bg-transparent text-[11px]"
              disabled={spec.beats.length <= FACTORY_LIMITS.minTakes}
              onClick={() => removeTakeAt(selected)}
            >
              Remover
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-[#262d3a] bg-transparent text-[11px]"
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
              <Copy className="mr-1 size-3" />
              Duplicar
            </Button>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 border-[#262d3a] bg-transparent text-[11px]"
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
                className="h-7 flex-1 border-[#262d3a] bg-transparent text-[11px]"
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
          </div>
        </aside>

        <section className="nle-monitor-well min-w-0">
          <ReelsStage
            dropOver={dropOver}
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
                  <JoinFxPlate name={frame.joinOverlay.name} opacity={frame.joinOverlay.opacity} />
                ) : null}
                {frame.programFade > 0 ? (
                  <div
                    className="absolute inset-0 bg-black"
                    style={{ opacity: frame.programFade }}
                  />
                ) : null}
                {frame.captionVisible ? (
                  <div
                    className="pointer-events-none absolute text-center font-bold text-white"
                    style={{
                      left: 70,
                      right: 70,
                      bottom: 140,
                      fontSize: 64,
                      lineHeight: 1.15,
                      textShadow: '0 2px 0 #000, 0 0 8px #000',
                    }}
                  >
                    Legenda do turno · queima 8s no ASS
                  </div>
                ) : null}
                {frame.branding.endCard ? (
                  <div className="pointer-events-none absolute inset-0 bg-black/70" />
                ) : null}
                {frame.branding.logo ? (
                  <div
                    className="pointer-events-none absolute flex items-center justify-center rounded-lg border border-white/40 bg-black/45 font-bold tracking-wide text-white"
                    style={{
                      left: FACTORY_BRANDING.logo.x,
                      top: FACTORY_BRANDING.logo.y,
                      width: FACTORY_BRANDING.logo.size,
                      height: FACTORY_BRANDING.logo.size,
                      fontSize: FACTORY_BRANDING.wordmarkFontSize,
                    }}
                  >
                    {brandCopy.wordmark}
                  </div>
                ) : null}
                {frame.branding.title ? (
                  <div
                    className="pointer-events-none absolute text-center font-bold text-white"
                    style={{
                      left: 90,
                      right: 90,
                      top: FACTORY_BRANDING.title.y,
                      fontSize: FACTORY_BRANDING.title.fontSize,
                      lineHeight: 1.1,
                      textShadow: '0 3px 0 #000, 0 0 18px #000',
                    }}
                  >
                    {brandCopy.title}
                  </div>
                ) : null}
                {frame.branding.lowerThird ? (
                  <div
                    className="pointer-events-none absolute rounded-sm bg-black/70 px-5 py-3 font-semibold text-white"
                    style={{
                      left: FACTORY_BRANDING.lowerThird.x,
                      bottom: FACTORY_BRANDING.lowerThird.bottom,
                      fontSize: FACTORY_BRANDING.lowerThird.fontSize,
                    }}
                  >
                    {brandCopy.lowerThird}
                  </div>
                ) : null}
                {frame.branding.cta ? (
                  <div
                    className="pointer-events-none absolute text-center font-bold text-white"
                    style={{
                      left: 90,
                      right: 90,
                      bottom: FACTORY_BRANDING.cta.bottom,
                      fontSize: FACTORY_BRANDING.cta.fontSize,
                      textShadow: '0 2px 0 #000',
                    }}
                  >
                    {brandCopy.cta}
                  </div>
                ) : null}
                {frame.branding.endCard ? (
                  <div
                    className="pointer-events-none absolute inset-x-16 text-center font-bold text-white"
                    style={{
                      top: 860,
                      fontSize: FACTORY_BRANDING.endCard.fontSize,
                      textShadow: '0 3px 0 #000',
                    }}
                  >
                    {brandCopy.endCard}
                  </div>
                ) : null}
                <div
                  className="pointer-events-none absolute inset-0 opacity-[0.12] mix-blend-overlay"
                  style={{
                    backgroundImage:
                      'repeating-radial-gradient(circle at 18% 22%, rgba(255,255,255,0.4) 0 0.55px, transparent 0.7px 2.3px)',
                  }}
                />
                <div className="pointer-events-none absolute inset-[54px] border border-white/20" />
                <div className="pointer-events-none absolute inset-[108px] border border-white/10" />
                <div
                  className="absolute left-8 top-8 rounded bg-black/60 px-4 py-2 font-mono text-white"
                  style={{ fontSize: 28 }}
                >
                  {formatTimecode(time)}
                </div>
                <div
                  className="absolute right-8 top-8 rounded bg-black/60 px-4 py-2 uppercase tracking-wide text-white/80"
                  style={{ fontSize: 24 }}
                >
                  1080×1920 · {playing ? 'play' : 'pause'}
                </div>
                {frame.inOverlap || frame.joinOverlay ? (
                  <div
                    className="absolute left-8 rounded bg-black/60 px-4 py-2 text-white"
                    style={{ bottom: 280, fontSize: 28 }}
                  >
                    {joinLabels[frame.incoming?.beat.join ?? beat.join]}
                    {frame.joinOverlay ? ` · ${joinOverlayLabels[frame.joinOverlay.name]}` : ''}
                  </div>
                ) : null}
                {!sources[selected] ? (
                  <div
                    className="pointer-events-none absolute inset-x-16 z-10 rounded-md bg-black/55 px-8 py-6 text-center text-white/80"
                    style={{ bottom: 420, fontSize: 36 }}
                  >
                    Solte um MP4 aqui
                  </div>
                ) : null}
              </>
            ) : null}
          </ReelsStage>
        </section>

        <aside className="flex w-[320px] shrink-0 flex-col border-l border-[#262d3a] bg-[#10131a]">
          <div className="nle-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-3 p-3">
              <h2 className="text-sm font-semibold">Take {selected + 1}</h2>
              <div className="space-y-2 rounded-md border border-[#262d3a] bg-[#161b24] p-3">
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
                <Label>Duração deste plano (s)</Label>
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
                <p className="text-[11px] text-muted-foreground">
                  Quanto este take fica no ecrã. Na timeline é a largura do bloco em V1.
                </p>
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
                <p className="text-[11px] text-muted-foreground">
                  {selected === 0
                    ? 'Take 1: o filme começa aqui. Esta transição não corre.'
                    : 'Como este take entra por cima do anterior (corte, dissolve ou fade a preto).'}
                </p>
              </div>
              <label className="block space-y-1 text-sm">
                <Label>Duração da transição (s)</Label>
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
                <p className="text-[11px] text-muted-foreground">
                  Tempo em que os dois takes se cruzam. Corte seco ~0,04s. Dissolve ~0,6s.
                </p>
              </label>
              <div className="space-y-1 text-sm">
                <Label>Flash no corte</Label>
                <FieldSelect
                  value={beat.joinOverlay ?? 'none'}
                  items={overlays.map((overlay) => ({
                    value: overlay,
                    label: joinOverlayLabels[overlay],
                  }))}
                  onChange={(joinOverlay) => patchBeat({ joinOverlay })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Cor gerada no meio da transição (flash branco, leak, burn). Linha FX. Não é
                  ficheiro.
                </p>
                <Label className="pt-2">Pack FX (ficheiro)</Label>
                <FieldSelect
                  value={beat.fxMode === 'none' ? 'none' : (beat.fxAssetId ?? 'auto')}
                  items={[
                    { value: 'auto', label: 'Auto (IA escolhe no catálogo)' },
                    { value: 'none', label: 'Sem pack' },
                    ...fxAssets.map((asset) => ({
                      value: asset.id,
                      label: `${asset.pack} · ${asset.id}`,
                    })),
                  ]}
                  onChange={(value) => {
                    if (value === 'auto') patchBeat({ fxMode: 'auto', fxAssetId: undefined });
                    else if (value === 'none') patchBeat({ fxMode: 'none', fxAssetId: undefined });
                    else patchBeat({ fxMode: undefined, fxAssetId: value });
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  {selected === 0
                    ? 'Take 1: wipe não corre. Pode ir um lens/filter em cima deste plano.'
                    : 'WebM com transparência no mesmo instante do corte (wipe, blur, flare). Auto = OpenAI escolhe.'}
                </p>
              </div>
              <div className="space-y-1 text-sm">
                <Label>Movimento da câmara</Label>
                <FieldSelect
                  value={beat.motion ?? 'none'}
                  items={motions.map((motion) => ({ value: motion, label: motionLabels[motion] }))}
                  onChange={(motion) => patchBeat({ motion })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Dentro deste take, não no corte. Estático = parado. Zoom lento = sala. Zoom no
                  prato = close.
                </p>
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
            </div>
            <section className="space-y-3 border-t border-[#262d3a] px-3 py-3">
              <h3 className="text-sm font-semibold">Capacidade desta fábrica</h3>
              <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-[#262d3a] bg-[#161b24] px-3 py-2">
                <p className="font-mono text-[12px]">
                  {capacity.takeCount}/{FACTORY_LIMITS.maxTakes} takes ·{' '}
                  {capacity.duration.toFixed(1)}s / {capacity.target}s
                </p>
                <p className="text-[11px] text-[#8a94a7]">
                  overlap {capacity.overlapSaved.toFixed(2)}s · comida{' '}
                  {Math.round(capacity.foodShare * 100)}% · ofício{' '}
                  {Math.round(capacity.kitchenShare * 100)}%
                </p>
              </div>
              <p className="text-[11px] text-[#8a94a7]">
                1 FFmpeg de cada vez neste KVM. Ken Burns (drift/punch) só no perfil HIGH. Título,
                logo, lower third, CTA e end card queimam em ASS/overlay; PNG do logo vem do
                restaurante.
              </p>
              {capacity.warnings.length ? (
                <ul className="list-disc space-y-1 pl-5 text-[12px] text-warning">
                  {capacity.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-[#8a94a7]">
                  Dentro do que a fábrica consegue publicar neste padrão.
                </p>
              )}
              <div className="space-y-3">
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
                <label className="block space-y-1 text-sm">
                  <Label>Duração alvo (s)</Label>
                  <Input
                    type="number"
                    min={8}
                    max={90}
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
            </section>
            <NleLookTutorial takeIndex={selected} packCount={fxAssets.length} />
          </div>
        </aside>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-1 border-t border-[#262d3a] bg-[#10131a] px-3">
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
          className="h-7 bg-[#d4a24c] text-[12px] text-black hover:bg-[#e0b25c]"
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
          className="h-7 border-[#262d3a] bg-[#161b24] text-[12px]"
          onClick={() => fileInputRef.current?.click()}
        >
          <FilePlus2 className="mr-1.5 size-3.5" />
          Adicionar arquivo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 border-[#262d3a] bg-transparent text-[12px]"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 className="mr-1.5 size-3.5" />
          Desfazer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 border-[#262d3a] bg-transparent text-[12px]"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 className="mr-1.5 size-3.5" />
          Refazer
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <TransportButton
            label="Afastar timeline"
            disabled={zoom <= 1}
            onClick={() => setZoom((value) => Math.max(1, Number((value - 0.5).toFixed(1))))}
          >
            <Minus className="size-4" />
          </TransportButton>
          <span className="w-8 text-center font-mono text-[10px] text-[#8a94a7]">
            {zoom.toFixed(1)}x
          </span>
          <TransportButton
            label="Aproximar timeline"
            disabled={zoom >= 4}
            onClick={() => setZoom((value) => Math.min(4, Number((value + 0.5).toFixed(1))))}
          >
            <Plus className="size-4" />
          </TransportButton>
          <p className="ml-2 font-mono text-xs text-[#8a94a7]">
            {formatTimecode(time)} / {formatTimecode(duration)}
          </p>
        </div>
      </div>
      <div className="nle-scroll h-[196px] shrink-0 overflow-x-auto border-t border-[#262d3a] bg-[#08090c] p-2">
        <div className="min-w-full" style={{ width: `${zoom * 100}%` }}>
          <div className="flex">
            <div className="flex w-9 shrink-0 flex-col font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-500">
              <div className="h-4" />
              <div className="flex h-24 items-center justify-center" title="Takes de câmera">
                V1
              </div>
              <div className="flex h-8 items-center justify-center" title="Overlay no join">
                FX
              </div>
              <div className="flex h-7 items-center justify-center" title="Legendas">
                CC
              </div>
              <div className="flex h-7 items-center justify-center" title="Música">
                A1
              </div>
            </div>
            <div
              ref={timelineRef}
              className="relative min-w-0 flex-1 select-none"
              onPointerDown={onTimelinePointer}
              onPointerMove={onTimelineMove}
              onPointerUp={onTimelineUp}
              onPointerCancel={onTimelineUp}
            >
              <div className="relative mb-0 h-4">
                {Array.from({ length: Math.floor(duration) + 1 }, (_, second) => (
                  <span
                    key={second}
                    className="absolute top-0 -translate-x-1/2 font-mono text-[9px] text-zinc-500"
                    style={{ left: `${duration > 0 ? (second / duration) * 100 : 0}%` }}
                  >
                    {second}s
                  </span>
                ))}
              </div>
              <div className="relative h-24 overflow-hidden rounded-sm bg-zinc-900">
                {clips.map((clip) => (
                  <div
                    key={`${clip.beat.name}-${clip.index}`}
                    title={`${clip.beat.name} · ${clip.duration.toFixed(1)}s · ${cameraRoleLabels[roleOf(clip.beat)]} · arraste para reordenar, pontas para trim`}
                    style={{
                      left: `${duration > 0 ? (clip.start / duration) * 100 : 0}%`,
                      width: `${duration > 0 ? (clip.duration / duration) * 100 : 0}%`,
                    }}
                    className={cn(
                      'absolute top-1 bottom-1 overflow-hidden rounded-sm border text-left text-[10px] font-medium text-white',
                      roleTone[roleOf(clip.beat)],
                      selected === clip.index ? 'ring-2 ring-[#d4a24c]' : 'opacity-90',
                    )}
                    onPointerDown={(event) => beginClipDrag(event, clip.index)}
                  >
                    <button
                      type="button"
                      aria-label={`Trim início do take ${clip.index + 1}`}
                      className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize bg-white/30 hover:bg-white"
                      onPointerDown={(event) => beginClipDrag(event, clip.index, 'left')}
                    />
                    <span className="block truncate px-2 pt-1.5">{clip.beat.name}</span>
                    <span className="block truncate px-2 opacity-85">
                      {cameraRoleLabels[roleOf(clip.beat)]} · {clip.duration.toFixed(1)}s
                    </span>
                    <button
                      type="button"
                      aria-label={`Trim fim do take ${clip.index + 1}`}
                      className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize bg-white/30 hover:bg-white"
                      onPointerDown={(event) => beginClipDrag(event, clip.index, 'right')}
                    />
                  </div>
                ))}
                {clips.slice(1).map((clip) => (
                  <div
                    key={`join-${clip.index}`}
                    title={`${joinLabels[clip.beat.join]} ${clip.joinOverlap.toFixed(2)}s`}
                    className="pointer-events-none absolute top-0 h-full w-px bg-white/70"
                    style={{ left: `${duration > 0 ? (clip.start / duration) * 100 : 0}%` }}
                  />
                ))}
              </div>
              <div className="relative mt-px h-8 overflow-hidden bg-zinc-900">
                {overlayHits.length ? (
                  overlayHits.map((hit) => (
                    <div
                      key={`fx-${hit.clipIndex}`}
                      title={`${joinOverlayLabels[hit.name]} ${hit.duration.toFixed(2)}s no meio do join`}
                      className={cn(
                        'absolute inset-y-1 overflow-hidden rounded-sm border px-1 text-[10px] font-medium text-white',
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
                  <p className="px-2 py-1.5 text-[10px] text-zinc-500">FX no join</p>
                )}
              </div>
              <div className="relative mt-px h-7 overflow-hidden bg-zinc-900">
                {spec.captions.strategy === 'full' ? (
                  <div
                    className="absolute inset-y-1 rounded-sm bg-emerald-400/50"
                    style={{
                      width: `${duration > 0 ? (Math.min(FACTORY_LIMITS.captionSeconds, duration) / duration) * 100 : 0}%`,
                    }}
                  />
                ) : (
                  <p className="px-2 py-1 text-[10px] text-zinc-500">CC off</p>
                )}
              </div>
              <div className="relative mt-px h-7 overflow-hidden bg-zinc-900">
                <div
                  className="absolute inset-y-1 left-0 rounded-l-sm bg-sky-400/40"
                  style={{
                    width: `${duration > 0 ? (FACTORY_LIMITS.audioFadeInSeconds / duration) * 100 : 0}%`,
                  }}
                />
                <div
                  className="absolute inset-y-1 rounded-r-sm bg-sky-400/40"
                  style={{
                    left: `${duration > 0 ? ((duration - FACTORY_LIMITS.audioFadeOutSeconds) / duration) * 100 : 0}%`,
                    width: `${duration > 0 ? (FACTORY_LIMITS.audioFadeOutSeconds / duration) * 100 : 0}%`,
                  }}
                />
              </div>
              <PlayheadMark pct={playheadPct} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
