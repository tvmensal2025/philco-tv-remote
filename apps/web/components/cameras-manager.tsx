'use client';

import { CheckCircle2, Pencil, Plus, Radio, Signal, SignalLow, Trash2, Video } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  CAMERA_PLACES,
  CUSTOM_PLACE,
  EDITOR_ROLES,
  cameraRoleLabel,
  isKnownPlace,
  roleForPlace,
  selectPlaceValue,
} from '@/lib/camera-roles';
import ExistingCamerasGuide from '@/components/existing-cameras-guide';

type CameraItem = {
  id: string;
  restaurant_id: string;
  name: string;
  position: number;
  enabled: boolean;
  last_seen_at: string | null;
  storage_prefix?: string;
  role?: string;
  place?: string;
  placeLabel?: string | null;
  previewId?: string | null;
};
type Restaurant = { id: string; name: string };

function seenLabel(iso: string | null, now: number) {
  if (!iso) return 'Sem sinal';
  const delta = now - Date.parse(iso);
  if (delta < 900_000) return 'No ar';
  if (delta < 3_600_000) return `${Math.max(1, Math.round(delta / 60_000))} min atrás`;
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CamerasManager({
  cameras: initial,
  restaurants,
  role,
}: {
  cameras: CameraItem[];
  restaurants: Restaurant[];
  role: string;
}) {
  const router = useRouter();
  const [cameras, setCameras] = useState(initial);
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? '');
  const [saving, setSaving] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const canConfigure = ['owner', 'admin'].includes(role);
  const visible = cameras.filter((camera) => camera.restaurant_id === restaurantId);
  // eslint-disable-next-line react-hooks/purity
  const now = useMemo(() => Date.now(), []);
  const onlineCount = visible.filter(
    (camera) => camera.last_seen_at && now - Date.parse(camera.last_seen_at) < 900_000,
  ).length;

  function patch(id: string, update: Partial<CameraItem>) {
    setCameras((items) => items.map((item) => (item.id === id ? { ...item, ...update } : item)));
  }

  async function save(camera: CameraItem) {
    setSaving(camera.id);
    const response = await fetch('/api/cameras', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cameraId: camera.id,
        name: camera.name,
        enabled: camera.enabled,
        storagePrefix: camera.storage_prefix,
        role: camera.role,
        place: camera.place,
        placeLabel: camera.placeLabel,
      }),
    });
    const data = await response.json();
    setSaving(null);
    if (response.ok) toast.success(`${camera.name} atualizada`);
    else toast.error(data.error ?? 'Não foi possível salvar.');
  }

  async function addCamera() {
    const response = await fetch('/api/cameras', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restaurantId, place: 'quarto' }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? 'Não foi possível incluir a câmera.');
      return;
    }
    toast.success('Câmera incluída');
    router.refresh();
  }

  async function removeCamera(camera: CameraItem) {
    if (visible.filter((item) => item.enabled).length <= 1 && camera.enabled) {
      toast.error('Deixe pelo menos uma câmera na sala.');
      return;
    }
    if (!window.confirm(`Tirar ${camera.name}?`)) return;
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
    setCameras((items) => items.filter((item) => item.id !== camera.id));
    toast.success('Câmera fora da sala');
    router.refresh();
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Radio className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">
              {onlineCount} de {visible.length} no ar
            </h2>
            <p className="text-sm text-muted-foreground">
              Inclua ângulos, escolha o que cada um é, e pause o que não entra no corte.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {restaurants.length > 1 ? (
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm font-medium"
              value={restaurantId}
              onChange={(event) => setRestaurantId(event.target.value)}
            >
              {restaurants.map((restaurant) => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                </option>
              ))}
            </select>
          ) : null}
          {canConfigure ? (
            <Button type="button" variant="outline" onClick={() => void addCamera()}>
              <Plus className="mr-2 h-4 w-4" />
              Nova câmera
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {visible.map((camera) => {
          const online = Boolean(
            camera.last_seen_at && now - Date.parse(camera.last_seen_at) < 900_000,
          );
          const label = cameraRoleLabel(
            camera.role,
            camera.position,
            camera.place,
            camera.placeLabel,
          );
          const place = selectPlaceValue(camera.place, camera.role, camera.position);
          const custom = place === CUSTOM_PLACE || Boolean(editing[camera.id]);
          return (
            <Card
              key={camera.id}
              className={cn('overflow-hidden', !camera.enabled && 'opacity-60')}
            >
              <div className="relative aspect-video bg-zinc-950">
                {camera.previewId ? (
                  <video
                    src={`/api/recordings/${camera.previewId}/media`}
                    muted
                    playsInline
                    preload="metadata"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
                    <Video className="h-8 w-8 opacity-50" />
                    <span className="text-xs">Sem take ainda</span>
                  </div>
                )}
                <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3">
                  <Badge
                    className={cn(
                      'font-medium',
                      online
                        ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-800',
                    )}
                  >
                    {online ? (
                      <>
                        <Signal className="mr-1 h-3 w-3" /> No ar
                      </>
                    ) : (
                      <>
                        <SignalLow className="mr-1 h-3 w-3" /> Sem sinal
                      </>
                    )}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-white/20 bg-black/40 text-white backdrop-blur-sm"
                  >
                    C{camera.position} · {label}
                  </Badge>
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-xs text-zinc-300">
                  {seenLabel(camera.last_seen_at, now)}
                </div>
              </div>

              <CardContent className="space-y-4 p-5">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Nome</label>
                  <input
                    className="w-full rounded-none border-b border-transparent bg-transparent px-0 py-1 text-lg font-semibold transition-colors hover:border-input focus:border-primary focus:outline-none"
                    value={camera.name}
                    disabled={!canConfigure}
                    onChange={(event) => patch(camera.id, { name: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    O que esta câmera é
                  </label>
                  <div className="flex gap-2">
                    <select
                      className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                      value={place}
                      disabled={!canConfigure}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (next === CUSTOM_PLACE) {
                          setEditing((current) => ({ ...current, [camera.id]: true }));
                          patch(camera.id, {
                            place: CUSTOM_PLACE,
                            placeLabel: camera.placeLabel || label,
                            role: camera.role || 'ambience',
                          });
                          return;
                        }
                        setEditing((current) => ({ ...current, [camera.id]: false }));
                        patch(camera.id, {
                          place: next,
                          role: roleForPlace(next),
                          placeLabel: null,
                        });
                      }}
                    >
                      {CAMERA_PLACES.map((item) => (
                        <option key={item.place} value={item.place}>
                          {item.label} — {item.hint}
                        </option>
                      ))}
                      <option value={CUSTOM_PLACE}>Editar…</option>
                    </select>
                    <Button
                      type="button"
                      size="icon"
                      variant={custom ? 'default' : 'outline'}
                      disabled={!canConfigure}
                      aria-label="Editar função"
                      onClick={() => {
                        setEditing((current) => ({ ...current, [camera.id]: !current[camera.id] }));
                        if (!camera.placeLabel) patch(camera.id, { placeLabel: label });
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                  {custom ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        placeholder="Ex: Varanda, mezanino, quarto 2"
                        value={camera.placeLabel ?? label}
                        disabled={!canConfigure}
                        onChange={(event) =>
                          patch(camera.id, {
                            place: isKnownPlace(camera.place) ? camera.place : CUSTOM_PLACE,
                            placeLabel: event.target.value,
                          })
                        }
                      />
                      <select
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                        value={camera.role || 'ambience'}
                        disabled={!canConfigure}
                        onChange={(event) => patch(camera.id, { role: event.target.value })}
                      >
                        {EDITOR_ROLES.map((item) => (
                          <option key={item.role} value={item.role}>
                            No corte: {item.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              </CardContent>

              <CardFooter className="flex items-center justify-between p-5 pt-0">
                <label className="flex cursor-pointer items-center gap-3">
                  <Switch
                    checked={camera.enabled}
                    disabled={!canConfigure}
                    onCheckedChange={(checked) => patch(camera.id, { enabled: checked })}
                  />
                  <span className="text-sm font-medium">
                    {camera.enabled ? 'Ativa' : 'Pausada'}
                  </span>
                </label>
                {canConfigure ? (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => void removeCamera(camera)}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Tirar
                    </Button>
                    <Button
                      size="sm"
                      disabled={saving === camera.id}
                      onClick={() => void save(camera)}
                    >
                      {saving === camera.id ? 'Salvando…' : 'Salvar'}
                    </Button>
                  </div>
                ) : null}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <ExistingCamerasGuide />

      <Card>
        <CardContent className="flex items-start gap-3 p-5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
          <p className="text-sm text-muted-foreground">
            Serviço, cozinha, prato e sala entram nos quatro programas. Quarto, fachada e hall
            entram como atmosfera. Se um ângulo faltar, aquele programa não sai.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
