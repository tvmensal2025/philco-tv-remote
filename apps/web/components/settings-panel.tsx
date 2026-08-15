'use client';

import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Cloud,
  Database,
  HardDrive,
  HeartPulse,
  Info,
  RefreshCw,
  Save,
  Server,
  Settings2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Restaurant = { id: string; name: string; timezone: string; settings: Record<string, unknown> };
type ConfigItem = {
  key: string;
  label: string;
  group: string;
  configured: boolean;
  required: boolean;
  hint: string;
};
type Health = { status: string; checks?: Record<string, { ok: boolean; detail?: string }> };

export default function SettingsPanel({
  restaurants: initial,
  role,
  configItems,
  instagramEnabled,
}: {
  restaurants: Restaurant[];
  role: string;
  configItems: ConfigItem[];
  instagramEnabled: boolean;
}) {
  const [restaurants, setRestaurants] = useState(initial);
  const [restaurantId, setRestaurantId] = useState(initial[0]?.id ?? '');
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const canEdit = ['owner', 'admin'].includes(role);
  const restaurant = restaurants.find((item) => item.id === restaurantId);
  const visibleConfig = configItems.filter(
    (item) => !['MINIO_PORT', 'MINIO_USE_SSL'].includes(item.key),
  );

  async function checkHealth() {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      setHealth(await response.json());
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void checkHealth();
  }, []);

  function update(field: string, value: string | number) {
    setRestaurants((items) =>
      items.map((item) =>
        item.id === restaurantId
          ? {
              ...item,
              ...(field === 'name' || field === 'timezone'
                ? { [field]: value }
                : { settings: { ...item.settings, [field]: value } }),
            }
          : item,
      ),
    );
  }

  async function save() {
    if (!restaurant) return;
    setSaving(true);
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        restaurantId: restaurant.id,
        name: restaurant.name,
        timezone: restaurant.timezone,
        windowBefore: Number(restaurant.settings.window_before ?? 12),
        windowAfter: Number(restaurant.settings.window_after ?? 8),
        activeStyle: restaurant.settings.active_style ?? 'natural',
      }),
    });
    const data = await response.json();
    setSaving(false);
    setMessage(response.ok ? 'Configurações salvas.' : data.error);
  }

  const checks = [
    {
      key: 'supabase',
      label: 'Conta e dados',
      description: 'Login e o que a casa registrou',
      icon: Database,
    },
    {
      key: 'storage',
      label: 'Armazenamento',
      description: 'Vídeos brutos e Reels prontos',
      icon: HardDrive,
    },
    { key: 'redis', label: 'Fila', description: 'Ordem de corte e publicação', icon: Server },
    { key: 'worker', label: 'Edição', description: 'Montagem dos Reels', icon: HeartPulse },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/enviar"
            className="rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
          >
            <p className="text-sm font-semibold">Enviar do celular</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Sem HD: baixe no app da câmera e mande para o CenaPronta.
            </p>
          </Link>
          <Link
            href="/recordings"
            className="rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
          >
            <p className="text-sm font-semibold">Escolher na fita</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Abrir a gravação e marcar o instante certo.
            </p>
          </Link>
          <Link
            href="/cameras"
            className="rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
          >
            <p className="text-sm font-semibold">Câmeras</p>
            <p className="mt-1 text-sm text-muted-foreground">Os ângulos da casa.</p>
          </Link>
          <Link
            href="/estudio"
            className="rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
          >
            <p className="text-sm font-semibold">Estúdio</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ritmo, o que roda sozinho, o que priorizar.
            </p>
          </Link>
          <Link
            href="/integrations"
            className="rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
          >
            <p className="text-sm font-semibold">WhatsApp e Instagram</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Onde o filme chega depois da aprovação.
            </p>
          </Link>
        </div>
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HeartPulse className="h-4 w-4" /> Saúde do sistema
              </CardTitle>
              <CardDescription>Se algo falhar aqui, o corte não sai.</CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setChecking(true);
                void checkHealth();
              }}
              disabled={checking}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', checking && 'animate-spin')} />
              {checking ? 'Testando…' : 'Testar conexões'}
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {checks.map((item) => {
              const Icon = item.icon;
              const check = health?.checks?.[item.key];
              return (
                <div key={item.key} className="flex items-center gap-3 rounded-lg border p-3">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <Badge
                    variant={
                      check?.ok ? 'success' : check === undefined ? 'secondary' : 'destructive'
                    }
                  >
                    {check?.ok ? 'Operacional' : check === undefined ? 'Verificando' : 'Atenção'}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" /> Restaurante e captura
              </CardTitle>
              <CardDescription>
                Defina a janela que será recuperada ao marcar um momento.
              </CardDescription>
            </div>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={restaurantId}
              onChange={(event) => setRestaurantId(event.target.value)}
            >
              {restaurants.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </CardHeader>
          {restaurant && (
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">
                Nome do restaurante
                <input
                  disabled={!canEdit}
                  value={restaurant.name}
                  onChange={(event) => update('name', event.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Fuso horário
                <select
                  disabled={!canEdit}
                  value={restaurant.timezone}
                  onChange={(event) => update('timezone', event.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
                >
                  <option value="America/Sao_Paulo">Brasília — São Paulo</option>
                  <option value="America/Manaus">Manaus</option>
                  <option value="America/Fortaleza">Fortaleza</option>
                  <option value="America/Recife">Recife</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium">
                Segundos antes
                <input
                  type="number"
                  min="3"
                  max="120"
                  disabled={!canEdit}
                  value={Number(restaurant.settings.window_before ?? 12)}
                  onChange={(event) => update('window_before', Number(event.target.value))}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Segundos depois
                <input
                  type="number"
                  min="3"
                  max="120"
                  disabled={!canEdit}
                  value={Number(restaurant.settings.window_after ?? 8)}
                  onChange={(event) => update('window_after', Number(event.target.value))}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
                />
              </label>
              {canEdit && (
                <div className="sm:col-span-2">
                  <Button onClick={save} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Salvando…' : 'Salvar alterações'}
                  </Button>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-4 w-4" /> Instagram e exportação
            </CardTitle>
            <CardDescription>
              O MP4 sempre pode ser exportado. A publicação automática é opcional.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Instagram profissional</p>
              <p className="text-xs text-muted-foreground">
                {instagramEnabled
                  ? 'Pronto para publicar depois da aprovação'
                  : 'Publicação automática ainda não ligada'}
              </p>
            </div>
            <Badge variant={instagramEnabled ? 'success' : 'secondary'}>
              {instagramEnabled ? 'Configurado' : 'Opcional'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>O que está ligado</CardTitle>
            <CardDescription>
              {visibleConfig.filter((item) => item.configured).length}/{visibleConfig.length}{' '}
              conexões ativas
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{
                  width: `${(visibleConfig.filter((item) => item.configured).length / visibleConfig.length) * 100}%`,
                }}
              />
            </div>
            {visibleConfig.map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-sm">
                <span
                  className={
                    item.configured
                      ? 'text-emerald-600'
                      : item.required
                        ? 'text-amber-600'
                        : 'text-muted-foreground'
                  }
                >
                  {item.configured ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <CircleAlert className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.hint}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex gap-3 p-6">
            <Info className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Segredos protegidos</p>
              <p className="text-xs text-muted-foreground">
                Chaves e senhas ficam só no servidor. Nada disso aparece no navegador.
              </p>
            </div>
          </CardContent>
        </Card>
      </aside>

      {message && (
        <div
          className="fixed bottom-4 right-4 z-50 rounded-md border bg-background px-4 py-3 shadow"
          role="status"
        >
          <span>{message}</span>
          <button className="ml-3 text-muted-foreground" onClick={() => setMessage('')}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
