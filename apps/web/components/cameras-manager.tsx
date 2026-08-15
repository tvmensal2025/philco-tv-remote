'use client';

import { CheckCircle2, Pencil, Plus, Radio, Signal, SignalLow, Trash2, Video } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import SofiaAgent from '@/components/sofia-agent';

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
  ingestMode?: 'folder' | 'rtsp' | 'phone';
  rtspUrl?: string;
  rtspHost?: string;
  rtspPort?: string;
  rtspUsername?: string;
  rtspPassword?: string;
  rtspBrand?: string;
  rtspChannel?: number;
  rtspHasPassword?: boolean;
  rtspTransport?: 'tcp' | 'udp';
  folderPath?: string;
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

  useEffect(() => {
    setCameras(initial);
  }, [initial]);
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
        ingestMode: camera.ingestMode ?? 'folder',
        rtspUrl: camera.rtspUrl ?? '',
        rtspHost: camera.rtspHost ?? '',
        rtspPort: camera.rtspPort ?? '554',
        rtspUsername: camera.rtspUsername ?? 'admin',
        rtspPassword: camera.rtspPassword ?? '',
        rtspBrand: camera.rtspBrand ?? 'intelbras',
        rtspChannel: camera.rtspChannel ?? camera.position,
        rtspTransport: camera.rtspTransport ?? 'tcp',
        folderPath: camera.folderPath ?? '',
      }),
    });
    const data = await response.json();
    setSaving(null);
    if (response.ok) {
      toast.success(`${camera.name} atualizada`);
      patch(camera.id, {
        rtspPassword: '',
        rtspUrl: '',
        rtspHasPassword:
          camera.ingestMode === 'rtsp'
            ? Boolean(camera.rtspHasPassword || camera.rtspPassword || camera.rtspUrl)
            : camera.rtspHasPassword,
      });
      router.refresh();
    } else toast.error(data.error ?? 'Não foi possível salvar.');
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
              A Sofia acha o gravador na Wi-Fi. Sem HD, mande o vídeo pelo celular. Pasta só quando
              o técnico já exporta.
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

      {canConfigure ? <SofiaAgent restaurantId={restaurantId} canConfigure={canConfigure} /> : null}

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
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    De onde vem o vídeo
                  </label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                    value={camera.ingestMode ?? 'folder'}
                    disabled={!canConfigure}
                    onChange={(event) =>
                      patch(camera.id, {
                        ingestMode: event.target.value as CameraItem['ingestMode'],
                      })
                    }
                  >
                    <option value="rtsp">Câmera na rede (RTSP) — sem HD</option>
                    <option value="phone">Celular — baixar no app da câmera e enviar</option>
                    <option value="folder">Pasta do gravador — quando o técnico tem o HD</option>
                  </select>
                  {camera.ingestMode === 'rtsp' ? (
                    <div className="space-y-2">
                      <input
                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-xs"
                        placeholder="Cole o RTSP ou só o IP: 192.168.0.8"
                        value={camera.rtspUrl || camera.rtspHost || ''}
                        disabled={!canConfigure}
                        autoComplete="off"
                        onChange={(event) => {
                          const value = event.target.value;
                          patch(
                            camera.id,
                            value.includes('://')
                              ? { rtspUrl: value }
                              : { rtspHost: value, rtspUrl: value },
                          );
                        }}
                      />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                          placeholder="Usuário"
                          value={camera.rtspUsername ?? 'admin'}
                          disabled={!canConfigure}
                          autoComplete="off"
                          onChange={(event) =>
                            patch(camera.id, { rtspUsername: event.target.value })
                          }
                        />
                        <input
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                          placeholder={camera.rtspHasPassword ? 'Senha já salva' : 'Senha'}
                          type="password"
                          value={camera.rtspPassword ?? ''}
                          disabled={!canConfigure}
                          autoComplete="new-password"
                          onChange={(event) =>
                            patch(camera.id, { rtspPassword: event.target.value })
                          }
                        />
                        <select
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                          value={camera.rtspBrand ?? 'intelbras'}
                          disabled={!canConfigure}
                          onChange={(event) => patch(camera.id, { rtspBrand: event.target.value })}
                        >
                          <option value="intelbras">Intelbras</option>
                          <option value="hikvision">Hikvision</option>
                          <option value="dahua">Dahua</option>
                          <option value="generic">Outra</option>
                        </select>
                        <input
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                          type="number"
                          min={1}
                          max={16}
                          value={camera.rtspChannel ?? camera.position}
                          disabled={!canConfigure}
                          onChange={(event) =>
                            patch(camera.id, {
                              rtspChannel: Number(event.target.value) || camera.position,
                            })
                          }
                        />
                      </div>
                      <select
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                        value={camera.rtspTransport ?? 'tcp'}
                        disabled={!canConfigure}
                        onChange={(event) =>
                          patch(camera.id, {
                            rtspTransport: event.target.value as 'tcp' | 'udp',
                          })
                        }
                      >
                        <option value="tcp">Transporte TCP (recomendado)</option>
                        <option value="udp">Transporte UDP</option>
                      </select>
                      <p className="text-xs text-muted-foreground">
                        A senha não volta para o navegador. Intelbras MHDX usa canal 1–4 no mesmo
                        IP.
                      </p>
                    </div>
                  ) : null}
                  {camera.ingestMode === 'phone' ? (
                    <p className="text-xs text-muted-foreground">
                      No app da câmera, baixe o clipe. No CenaPronta, abra Enviar e escolha o vídeo.
                      Não precisa de HD nem de pasta.
                    </p>
                  ) : null}
                  {camera.ingestMode === 'folder' ? (
                    <div className="space-y-2">
                      <input
                        className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-xs"
                        placeholder="C:\CenaPronta\cameras"
                        value={camera.folderPath ?? ''}
                        disabled={!canConfigure}
                        onChange={(event) => patch(camera.id, { folderPath: event.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        O NVR grava em C1–C4 nesta pasta. O Uploader lê e deixa o original no lugar.
                      </p>
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
