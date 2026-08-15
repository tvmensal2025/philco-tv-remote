'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Smartphone, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Camera = {
  id: string;
  name: string;
  position: number;
  restaurant_id: string;
};
type Restaurant = { id: string; name: string };
type SharedClip = { id: string; name: string; size: number; type: string; lastModified?: number };
type Slot = { status: 'idle' | 'uploading' | 'done' | 'error'; name?: string; error?: string };

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

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PhoneIngest({
  cameras,
  restaurants,
  shareId,
}: {
  cameras: Camera[];
  restaurants: Restaurant[];
  shareId?: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? '');
  const restaurantCameras = useMemo(
    () => cameras.filter((camera) => camera.restaurant_id === restaurantId),
    [cameras, restaurantId],
  );
  const [position, setPosition] = useState(restaurantCameras[0]?.position ?? 1);
  const [shared, setShared] = useState<SharedClip | null>(null);
  const [slot, setSlot] = useState<Slot>({ status: 'idle' });
  const [files, setFiles] = useState<File[]>([]);
  const [when, setWhen] = useState('');

  function capturedAtOf(file?: { lastModified?: number } | null) {
    if (when) {
      const parsed = new Date(when);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    if (file?.lastModified && file.lastModified > 0)
      return new Date(file.lastModified).toISOString();
    return new Date().toISOString();
  }

  useEffect(() => {
    const next = restaurantCameras[0]?.position;
    if (next && !restaurantCameras.some((camera) => camera.position === position)) {
      setPosition(next);
    }
  }, [position, restaurantCameras]);

  useEffect(() => {
    if (!shareId) return;
    void fetch(`/api/share-target?id=${shareId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Envio expirado');
        setShared(data);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Envio expirado'));
  }, [shareId]);

  async function uploadFile(file: File, cameraPosition: number) {
    const body = new FormData();
    body.set('file', file);
    body.set('restaurantId', restaurantId);
    body.set('cameraPosition', String(cameraPosition));
    body.set('capturedAt', capturedAtOf(file));
    body.set('durationSeconds', String(Math.round(await readDuration(file))));
    const response = await fetch('/api/recordings/upload', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Falha no envio');
    return data;
  }

  async function send() {
    if (!restaurantId || slot.status === 'uploading') return;
    setSlot({ status: 'uploading', name: shared?.name ?? files[0]?.name });
    try {
      if (shared && shareId) {
        const response = await fetch('/api/share-target', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            shareId,
            restaurantId,
            cameraPosition: position,
            capturedAt: capturedAtOf(shared),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Falha no envio');
      } else {
        if (!files.length) {
          setSlot({ status: 'idle' });
          toast.error('Escolha o vídeo no celular.');
          return;
        }
        for (const file of files) await uploadFile(file, position);
      }
      setSlot({ status: 'done', name: shared?.name ?? files[0]?.name });
      toast.success('Vídeo no CenaPronta');
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha no envio';
      setSlot({ status: 'error', error: message });
      toast.error(message);
    }
  }

  const ready = Boolean(shared || files.length);

  return (
    <div className="mx-auto max-w-lg space-y-6 pb-16">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Sem HD
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Enviar do celular</h1>
        <p className="text-sm text-muted-foreground">
          No app da câmera, baixe o clipe. Aqui, escolha o vídeo e a câmera. O CenaPronta não
          precisa do gravador.
        </p>
      </div>

      {restaurants.length > 1 ? (
        <label className="block space-y-1 text-sm font-medium">
          Casa
          <select
            className="h-12 w-full rounded-xl border bg-background px-3 text-base"
            value={restaurantId}
            onChange={(event) => setRestaurantId(event.target.value)}
          >
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-medium">Qual câmera é essa</p>
        <div className="grid grid-cols-2 gap-2">
          {restaurantCameras.map((camera) => (
            <button
              key={camera.id}
              type="button"
              onClick={() => setPosition(camera.position)}
              className={cn(
                'rounded-xl border px-3 py-3 text-left text-sm font-medium transition',
                position === camera.position
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted/40',
              )}
            >
              C{camera.position}
              <span className="mt-0.5 block truncate text-xs font-normal">{camera.name}</span>
            </button>
          ))}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
        multiple
        className="sr-only"
        onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-muted/30 px-4 py-8 text-center"
      >
        <Smartphone className="h-8 w-8 text-primary" />
        <span className="text-base font-semibold">
          {files.length ? `${files.length} vídeo(s) escolhido(s)` : 'Escolher no rolo da câmera'}
        </span>
        <span className="max-w-xs text-sm text-muted-foreground">
          iCSee, XMEye, Intelbras: baixe o vídeo, depois abra aqui e mande.
        </span>
      </button>

      {shared ? (
        <div className="rounded-xl border bg-card px-4 py-3 text-sm">
          <p className="font-medium">Recebido do app da câmera</p>
          <p className="text-muted-foreground">
            {shared.name} · {formatBytes(shared.size)}
          </p>
        </div>
      ) : null}

      {files.map((file) => (
        <div
          key={`${file.name}-${file.size}`}
          className="rounded-xl border bg-card px-4 py-3 text-sm"
        >
          <p className="font-medium">{file.name}</p>
          <p className="text-muted-foreground">{formatBytes(file.size)}</p>
        </div>
      ))}

      <label className="block space-y-1 text-sm font-medium">
        Quando foi gravado
        <input
          type="datetime-local"
          className="h-12 w-full rounded-xl border bg-background px-3 text-base"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
        />
        <span className="text-xs font-normal text-muted-foreground">
          Vazio usa a data do arquivo no celular.
        </span>
      </label>

      <Button
        type="button"
        size="lg"
        className="h-12 w-full text-base"
        disabled={!ready || slot.status === 'uploading'}
        onClick={() => void send()}
      >
        {slot.status === 'uploading' ? (
          'Enviando…'
        ) : (
          <>
            <Upload className="mr-2 h-4 w-4" />
            Subir para o CenaPronta
          </>
        )}
      </Button>

      {slot.status === 'done' ? (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
          <div>
            <p className="font-medium">Já está na fita.</p>
            <button
              type="button"
              className="mt-1 text-emerald-800 underline-offset-4 hover:underline dark:text-emerald-300"
              onClick={() => router.push('/recordings')}
            >
              Abrir a fita e gerar o Reel
            </button>
          </div>
        </div>
      ) : null}

      {slot.status === 'error' ? <p className="text-sm text-destructive">{slot.error}</p> : null}

      <ol className="space-y-2 text-sm text-muted-foreground">
        <li>1. Abra o app da câmera e baixe o trecho.</li>
        <li>2. Volte aqui e escolha o arquivo.</li>
        <li>3. Diga qual câmera é. O corte acontece no CenaPronta, não no HD.</li>
      </ol>
    </div>
  );
}
