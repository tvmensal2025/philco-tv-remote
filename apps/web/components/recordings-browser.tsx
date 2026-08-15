'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Clapperboard,
  Copy,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  CAMERA_PLACES,
  CUSTOM_PLACE,
  cameraRoleLabel,
  mosaicColumns,
  roleForPlace,
  selectPlaceValue,
} from '@/lib/camera-roles';
import { cn } from '@/lib/utils';
import { ReelDurationPicker, type ReelDurationChoice } from '@/components/reel-duration-picker';

type Recording = {
  id: string;
  object_key: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number | null;
  size_bytes: number | null;
  camera_id: string;
  index_status?: string | null;
  cameras: { name: string; position: number } | null;
};
type Camera = {
  id: string;
  name: string;
  position: number;
  restaurant_id: string;
  enabled?: boolean;
  storage_prefix?: string;
  role?: string;
  place?: string;
  placeLabel?: string | null;
};
type Restaurant = { id: string; name: string };
type SlotState = {
  status: 'idle' | 'uploading' | 'uploaded' | 'error';
  name?: string;
  error?: string;
  preview?: string;
};
type Take = { id: string; start: number; end: number; clips: Recording[] };

const TAKE_BUCKET_MS = 120_000;

const indexTone: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  indexing: 'bg-info/15 text-info',
  indexed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  failed: 'bg-destructive/15 text-destructive',
  skipped: 'bg-muted text-muted-foreground',
};

function clusterTakes(recordings: Recording[]): Take[] {
  const buckets = new Map<number, Recording[]>();
  for (const recording of recordings) {
    const bucket = Math.floor(Date.parse(recording.started_at) / TAKE_BUCKET_MS) * TAKE_BUCKET_MS;
    if (!Number.isFinite(bucket)) continue;
    const list = buckets.get(bucket) ?? [];
    list.push(recording);
    buckets.set(bucket, list);
  }
  return [...buckets.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([start, clips]) => ({
      id: String(start),
      start,
      end: Math.max(start, ...clips.map((clip) => Date.parse(clip.ended_at) || start)),
      clips,
    }));
}

function takeWindow(take: Take) {
  const starts = take.clips.map((clip) => Date.parse(clip.started_at));
  const ends = take.clips.map((clip) => Date.parse(clip.ended_at));
  const overlapStart = Math.max(...starts);
  const overlapEnd = Math.min(...ends);
  const overlapped = overlapEnd - overlapStart >= 8_000;
  const from = overlapped ? overlapStart : take.start;
  const to = overlapped ? overlapEnd : take.end;
  const mid = from + Math.floor((to - from) / 2);
  const clamp = (seconds: number) => Math.max(3, Math.min(120, seconds));
  return {
    occurredAt: new Date(mid).toISOString(),
    beforeSeconds: clamp(Math.floor((mid - from) / 1000) - 1),
    afterSeconds: clamp(Math.floor((to - mid) / 1000) - 1),
  };
}

function formatClock(ms: number) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(ms: number) {
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatDuration(seconds: number | null | undefined) {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function inboxPath(position: number) {
  return `C:\\CenaPronta\\cameras\\C${position}`;
}

function readDuration(file: File) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 45;
      URL.revokeObjectURL(url);
      resolve(Math.max(3, duration));
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(45);
    };
    video.src = url;
  });
}

export default function RecordingsBrowser({
  recordings,
  cameras,
  restaurants,
}: {
  recordings: Recording[];
  cameras: Camera[];
  restaurants: Restaurant[];
}) {
  const router = useRouter();
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? '');
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState<ReelDurationChoice>('ai');
  const [adding, setAdding] = useState(false);
  const [slots, setSlots] = useState<Record<number, SlotState>>({});
  const [hoverDrop, setHoverDrop] = useState<number | null>(null);
  const [takeId, setTakeId] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const [localCameras, setLocalCameras] = useState(cameras);
  const [isPhone, setIsPhone] = useState(false);
  const restaurantCameras = localCameras.filter((camera) => camera.restaurant_id === restaurantId);
  const restaurantRecordings = useMemo(
    () =>
      recordings.filter((item) => restaurantCameras.some((camera) => camera.id === item.camera_id)),
    [recordings, restaurantCameras],
  );
  const takes = useMemo(() => clusterTakes(restaurantRecordings), [restaurantRecordings]);
  const selectedTake = takes.find((take) => take.id === takeId) ?? takes[0] ?? null;
  const cameraCount = selectedTake
    ? new Set(selectedTake.clips.map((clip) => clip.cameras?.position ?? clip.camera_id)).size
    : Object.values(slots).filter(
        (slot) => slot.status === 'uploaded' || slot.status === 'uploading',
      ).length;
  const ready = cameraCount >= 2;
  const showAdd = restaurantCameras.length < 16;
  const tileCount = restaurantCameras.length + (showAdd ? 1 : 0);
  const columns = mosaicColumns(Math.max(tileCount, 2));

  useEffect(() => {
    setLocalCameras(cameras);
  }, [cameras]);

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const sync = () => setIsPhone(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  async function receiveFile(position: number, file?: File) {
    if (!file || busy) return;
    const previous = slots[position]?.preview;
    if (previous) URL.revokeObjectURL(previous);
    const preview = URL.createObjectURL(file);
    setSlots((current) => ({
      ...current,
      [position]: { status: 'uploading', name: file.name, preview },
    }));
    setPlayingId(position);
    const duration = await readDuration(file);
    const body = new FormData();
    body.set('file', file);
    body.set('restaurantId', restaurantId);
    body.set('cameraPosition', String(position));
    body.set('capturedAt', new Date(file.lastModified || Date.now()).toISOString());
    body.set('durationSeconds', String(Math.round(duration)));
    const response = await fetch('/api/recordings/upload', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) {
      setSlots((current) => ({
        ...current,
        [position]: { status: 'error', name: file.name, preview, error: data.error },
      }));
      toast.error(data.error ?? `Falha no C${position}`);
      return;
    }
    setSlots((current) => ({
      ...current,
      [position]: { status: 'uploaded', name: file.name, preview },
    }));
    toast.success(`C${position} no ar`);
    router.refresh();
  }

  async function generate() {
    if (!restaurantId || busy) return;
    setBusy(true);
    const clientRequestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = clientRequestId;
    try {
      const window = selectedTake ? takeWindow(selectedTake) : null;
      const response = await fetch('/api/moments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restaurantId, clientRequestId, duration, ...(window ?? {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível gerar o Reel.');
      requestIdRef.current = null;
      const count = Array.isArray(data.reels) ? data.reels.length : 1;
      toast.success(count === 1 ? 'Reel na fila' : `${count} Reels na fila`);
      const reelId = data.reel?.id ?? data.reels?.[0]?.id;
      router.push(reelId ? `/reels/${reelId}` : '/reels');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao gerar.');
      setBusy(false);
    }
  }

  async function openFolder(position: number) {
    await fetch('/api/recordings/inbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ position }),
    });
  }

  async function changePlace(camera: Camera, place: string) {
    let nextPlace = place;
    let placeLabel: string | null = null;
    let role = roleForPlace(place);
    if (place === CUSTOM_PLACE) {
      const typed = window.prompt(
        'Como chama esta câmera?',
        camera.placeLabel ||
          cameraRoleLabel(camera.role, camera.position, camera.place, camera.placeLabel),
      );
      if (!typed?.trim()) return;
      placeLabel = typed.trim();
      nextPlace = CUSTOM_PLACE;
      role =
        camera.role === 'master' ||
        camera.role === 'side' ||
        camera.role === 'food' ||
        camera.role === 'ambience'
          ? camera.role
          : 'ambience';
    }
    const label = cameraRoleLabel(role, camera.position, nextPlace, placeLabel);
    const nextName = CAMERA_PLACES.some(
      (item) => camera.name === item.label || camera.name === `C${camera.position} ${item.label}`,
    )
      ? `C${camera.position} ${label}`
      : camera.name;
    setLocalCameras((items) =>
      items.map((item) =>
        item.id === camera.id
          ? { ...item, place: nextPlace, role, name: nextName, placeLabel }
          : item,
      ),
    );
    const response = await fetch('/api/cameras', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cameraId: camera.id,
        name: nextName,
        enabled: true,
        storagePrefix: camera.storage_prefix,
        role,
        place: nextPlace,
        placeLabel,
      }),
    });
    if (!response.ok) {
      const data = await response.json();
      toast.error(data.error ?? 'Não foi possível mudar a função.');
      router.refresh();
      return;
    }
    toast.success(`${label} em C${camera.position}`);
  }

  async function addCamera() {
    if (adding || !restaurantId) return;
    setAdding(true);
    const response = await fetch('/api/cameras', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restaurantId, place: 'quarto' }),
    });
    const data = await response.json();
    setAdding(false);
    if (!response.ok) {
      toast.error(data.error ?? 'Não foi possível incluir a câmera.');
      return;
    }
    toast.success(`C${data.camera?.position ?? ''} incluída`);
    router.refresh();
  }

  async function removeCamera(camera: Camera) {
    if (restaurantCameras.length <= 1) {
      toast.error('Deixe pelo menos uma câmera na sala.');
      return;
    }
    if (
      !window.confirm(
        `Tirar C${camera.position} · ${cameraRoleLabel(camera.role, camera.position, camera.place)}?`,
      )
    )
      return;
    const response = await fetch('/api/cameras', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cameraId: camera.id }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? 'Não foi possível tirar a câmera.');
      return;
    }
    setLocalCameras((items) => items.filter((item) => item.id !== camera.id));
    toast.success(`C${camera.position} saiu da sala`);
    router.refresh();
  }

  function clipFor(position: number) {
    return selectedTake?.clips.find((clip) => (clip.cameras?.position ?? 0) === position) ?? null;
  }

  function sourceFor(position: number, clip: Recording | null) {
    const live = !selectedTake || selectedTake.id === takes[0]?.id;
    if (live && slots[position]?.preview) return slots[position].preview;
    return clip ? `/api/recordings/${clip.id}/media` : null;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {selectedTake
              ? `${formatDay(selectedTake.start)} · ${formatClock(selectedTake.start)}`
              : 'Sala de câmeras'}
          </p>
          <p className="text-sm text-muted-foreground">
            RTSP, celular ou pasta do gravador. Escolha o instante e gere o Reel.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {restaurants.length > 1 ? (
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={restaurantId}
              onChange={(event) => {
                setRestaurantId(event.target.value);
                setTakeId(null);
              }}
            >
              {restaurants.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : null}
          <ReelDurationPicker value={duration} onChange={setDuration} />
          <Button
            type="button"
            size="lg"
            onClick={() => void generate()}
            disabled={busy || (!ready && !selectedTake)}
          >
            <Clapperboard className="mr-2 h-4 w-4" />
            {busy ? 'Gerando…' : 'Gerar Reel'}
          </Button>
        </div>
      </div>

      <Link
        href="/enviar"
        className="flex items-center gap-3 rounded-xl border bg-primary/5 px-4 py-3 text-sm transition hover:bg-primary/10"
      >
        <Smartphone className="h-5 w-5 shrink-0 text-primary" />
        <span>
          <span className="font-medium">Sem acesso ao HD?</span>{' '}
          <span className="text-muted-foreground">
            Baixe o clipe no app da câmera e envie pelo celular.
          </span>
        </span>
      </Link>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-2 shadow-sm">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {restaurantCameras.map((camera) => {
            const clip = clipFor(camera.position);
            const src = sourceFor(camera.position, clip);
            const slot = slots[camera.position];
            const active = playingId === camera.position;
            const status =
              slot?.status === 'uploading'
                ? 'Enviando…'
                : slot?.status === 'error'
                  ? slot.error
                  : clip
                    ? formatDuration(clip.duration_seconds)
                    : 'Vazio';
            return (
              <div
                key={camera.id}
                className={cn(
                  'relative aspect-video min-h-[140px] overflow-hidden rounded-lg bg-black ring-1 ring-white/10',
                  hoverDrop === camera.position && 'ring-2 ring-emerald-400',
                  slot?.status === 'error' && 'ring-2 ring-destructive',
                  active && 'ring-2 ring-white/40',
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  setHoverDrop(camera.position);
                }}
                onDragLeave={() =>
                  setHoverDrop((current) => (current === camera.position ? null : current))
                }
                onDrop={(event) => {
                  event.preventDefault();
                  setHoverDrop(null);
                  void receiveFile(camera.position, event.dataTransfer.files[0]);
                }}
              >
                <input
                  ref={(node) => {
                    fileInputs.current[camera.position] = node;
                  }}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  onChange={(event) => void receiveFile(camera.position, event.target.files?.[0])}
                />
                {src ? (
                  <video
                    key={src}
                    src={src}
                    muted={!active}
                    playsInline
                    preload="metadata"
                    controls={active}
                    className="absolute inset-0 h-full w-full object-cover"
                    onClick={() => setPlayingId(camera.position)}
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      if (video.currentTime < 0.05) video.currentTime = 0.12;
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
                    onClick={() => fileInputs.current[camera.position]?.click()}
                  >
                    <Upload className="h-5 w-5" />
                    <span className="text-xs">Solte o ISO</span>
                  </button>
                )}
                <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent p-2.5">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                      C{camera.position}
                    </p>
                    <select
                      className="mt-0.5 max-w-full truncate rounded-md border-0 bg-black/40 px-1.5 py-0.5 text-sm font-semibold text-white outline-none ring-1 ring-white/10 backdrop-blur-sm focus:ring-white/40"
                      value={selectPlaceValue(camera.place, camera.role, camera.position)}
                      onChange={(event) => void changePlace(camera, event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {CAMERA_PLACES.map((item) => (
                        <option key={item.place} value={item.place} className="text-zinc-900">
                          {item.label}
                        </option>
                      ))}
                      <option value={CUSTOM_PLACE} className="text-zinc-900">
                        {camera.placeLabel ? `Editar · ${camera.placeLabel}` : 'Editar…'}
                      </option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    {clip?.index_status ? (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium',
                          indexTone[clip.index_status] ?? indexTone.pending,
                        )}
                      >
                        {clip.index_status === 'indexed'
                          ? 'Indexado'
                          : clip.index_status === 'indexing'
                            ? 'Indexando'
                            : clip.index_status === 'failed'
                              ? 'Falhou'
                              : 'Na fila'}
                      </span>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-white hover:bg-white/15 hover:text-white"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => fileInputs.current[camera.position]?.click()}
                        >
                          <Upload className="h-4 w-4" />
                          {isPhone ? 'Enviar do celular' : 'Escolher arquivo'}
                        </DropdownMenuItem>
                        {isPhone ? null : (
                          <>
                            <DropdownMenuItem
                              onClick={() => {
                                void navigator.clipboard.writeText(inboxPath(camera.position));
                                toast.success('Pasta copiada');
                              }}
                            >
                              <Copy className="h-4 w-4" />
                              Copiar pasta
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void openFolder(camera.position)}>
                              <FolderOpen className="h-4 w-4" />
                              Abrir no Explorer
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => void removeCamera(camera)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Tirar câmera
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
                  <p className="truncate text-xs text-zinc-300">{slot?.name ?? status}</p>
                </div>
              </div>
            );
          })}

          {showAdd ? (
            <button
              type="button"
              disabled={adding}
              onClick={() => void addCamera()}
              className="flex aspect-video min-h-[140px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 bg-zinc-900/60 text-zinc-400 transition hover:border-white/40 hover:bg-zinc-900 hover:text-white disabled:opacity-60"
            >
              <Plus className="h-6 w-6" />
              <span className="text-sm font-medium">{adding ? 'Incluindo…' : 'Nova câmera'}</span>
              <span className="text-[11px] text-zinc-500">Serviço, quarto, sala…</span>
            </button>
          ) : null}
        </div>
      </div>

      {takes.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-14 text-center">
          <h3 className="text-lg font-semibold">Nenhum take ainda</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Monte o quadro. Sem HD,{' '}
            <Link
              href="/enviar"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              envie o vídeo do celular
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Takes</h2>
              <p className="text-sm text-muted-foreground">
                Cada linha é um instante com as câmeras que cobriram juntos.
              </p>
            </div>
            <Badge variant="secondary">{takes.length}</Badge>
          </div>
          <div className="overflow-hidden rounded-xl border bg-card">
            {takes.map((take) => {
              const positions = new Set(take.clips.map((clip) => clip.cameras?.position ?? 0));
              const selected = selectedTake?.id === take.id;
              const longest = Math.max(
                0,
                ...take.clips.map((clip) => Number(clip.duration_seconds ?? 0)),
              );
              return (
                <button
                  key={take.id}
                  type="button"
                  onClick={() => {
                    setTakeId(take.id);
                    const first =
                      take.clips.find((clip) => clip.cameras?.position)?.cameras?.position ?? null;
                    setPlayingId(first);
                  }}
                  className={cn(
                    'flex w-full items-center gap-4 border-b px-4 py-3 text-left last:border-b-0 transition-colors hover:bg-muted/50',
                    selected && 'bg-accent/60',
                  )}
                >
                  <div className="w-16 shrink-0">
                    <p className="font-semibold tabular-nums">{formatClock(take.start)}</p>
                    <p className="text-xs text-muted-foreground">{formatDay(take.start)}</p>
                  </div>
                  <div className="flex flex-1 flex-wrap gap-1.5">
                    {restaurantCameras.map((camera) => {
                      const on = positions.has(camera.position);
                      return (
                        <span
                          key={camera.id}
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[11px] font-medium',
                            on
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          C{camera.position}
                        </span>
                      );
                    })}
                  </div>
                  <span className="hidden text-sm tabular-nums text-muted-foreground sm:block">
                    {formatDuration(longest)}
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {positions.size}/{restaurantCameras.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
