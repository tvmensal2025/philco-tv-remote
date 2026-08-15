'use client';

import { createBrowserClient } from '@supabase/ssr';
import { AlertCircle, CheckCircle2, Clapperboard, Clock3, Film, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis } from 'recharts';
import { toast } from 'sonner';
import { NumberTicker } from '@/components/number-ticker';
import { groupFilms, ProgramFilm, type FilmShot } from '@/components/program-film';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  greetingForHour,
  hourBars,
  humanReelFailure,
  readyByDay,
  todayCounts,
  zonedHour,
} from '@/lib/house-today';
import { restaurantOpsStatus } from '@/lib/restaurant-ops';
import { cn } from '@/lib/utils';

type Restaurant = { id: string; name: string; timezone: string; settings: Record<string, unknown> };
type Camera = { id: string; restaurant_id: string; last_seen_at: string | null; enabled: boolean };

const readyChartConfig = {
  prontos: { label: 'Prontos', color: 'hsl(152 100% 28%)' },
} satisfies ChartConfig;

const hourChartConfig = {
  cortes: { label: 'Cortes', color: 'hsl(152 55% 36%)' },
} satisfies ChartConfig;

const kpis = [
  { key: 'ready' as const, label: 'Prontos', href: '/reels?status=ready', icon: Film },
  { key: 'queued' as const, label: 'Na fila', href: '/reels?status=queued', icon: Loader2 },
  {
    key: 'toApprove' as const,
    label: 'Para aprovar',
    href: '/reels?status=ready',
    icon: CheckCircle2,
  },
  { key: 'failed' as const, label: 'Falhou', href: '/reels?status=failed', icon: AlertCircle },
];

export default function DashboardOverview({
  initialReels,
  weekReels,
  weekMoments,
  restaurants,
  cameras,
  role,
  runtimeConfig,
}: {
  initialReels: FilmShot[];
  weekReels: FilmShot[];
  weekMoments: { occurred_at: string }[];
  restaurants: Restaurant[];
  cameras: Camera[];
  role: string;
  runtimeConfig: { supabaseUrl: string; supabaseAnonKey: string };
}) {
  const router = useRouter();
  const [reels, setReels] = useState(initialReels);
  const [week, setWeek] = useState(weekReels);
  const [busy, setBusy] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const supabase = useMemo(
    () => createBrowserClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey),
    [runtimeConfig],
  );
  const canEdit = role !== 'viewer';
  const restaurantId = restaurants[0]?.id ?? '';
  const restaurantName = restaurants[0]?.name || 'A casa';
  const timeZone = restaurants[0]?.timezone || 'America/Sao_Paulo';
  const films = useMemo(() => groupFilms(reels), [reels]);
  const latest = films[0];
  const rest = films.slice(1, 4);
  const houseCameras = cameras.filter(
    (camera) => camera.restaurant_id === restaurantId && camera.enabled,
  );
  const lastSeen = houseCameras
    .map((camera) => Date.parse(camera.last_seen_at ?? ''))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];
  const nowHour = zonedHour(new Date().toISOString(), timeZone) ?? 12;
  const greeting = greetingForHour(nowHour);
  const counts = useMemo(() => todayCounts(week, timeZone), [week, timeZone]);
  const readySeries = useMemo(() => readyByDay(week, timeZone), [week, timeZone]);
  const shiftHours = useMemo(() => hourBars(weekMoments, timeZone), [weekMoments, timeZone]);
  const ops = restaurantOpsStatus({ cameras: houseCameras, reelsToday: week });
  const attention = useMemo(() => {
    const actionable = week.filter((reel) => reel.status === 'ready' || reel.status === 'failed');
    return actionable.slice(0, 5);
  }, [week]);
  const camerasLive = ops.code === 'live' || ops.camerasOnline > 0;
  const calm = attention.length === 0 && counts.queued === 0 && camerasLive;

  async function refresh() {
    const response = await fetch('/api/reels', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.reels)) return;
    const next = (data.reels as FilmShot[]).filter((reel) => reel.status !== 'discarded');
    setReels(next.slice(0, 24));
    setWeek(next);
  }

  const onChange = useCallback(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('reels-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reels' }, onChange)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, onChange]);

  async function mark() {
    if (!restaurantId || busy) return;
    setBusy(true);
    const clientRequestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = clientRequestId;
    const response = await fetch('/api/moments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restaurantId, clientRequestId }),
    });
    const result = await response.json();
    if (!response.ok) {
      setBusy(false);
      toast.error(result.error ?? 'Não foi possível cortar.');
      if (String(result.error ?? '').includes('gravação')) router.push('/recordings');
      return;
    }
    requestIdRef.current = null;
    const reelId = result.reel?.id ?? result.reels?.[0]?.id;
    toast.success('Filme na fila');
    if (reelId) router.push(`/reels/${reelId}`);
    else router.push('/reels');
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {greeting}
          </p>
          <h2 className="mt-1 font-heading text-3xl font-semibold tracking-tight">
            {restaurantName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {ops.camerasOnline}/{ops.camerasEnabled || houseCameras.length} câmeras no ar
            {lastSeen
              ? ` · última imagem às ${new Date(lastSeen).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone })}`
              : ' · aguardando vídeo'}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="lg"
              className="h-11 rounded-xl"
              onClick={() => void mark()}
              disabled={busy || !restaurantId}
            >
              {busy ? 'Gerando…' : 'Gerar do último take'}
            </Button>
          </div>
        ) : null}
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.key} href={item.href} className="group">
              <Card className="shadow-[var(--shadow-card)] transition-shadow group-hover:shadow-[var(--shadow-card-hover)]">
                <CardHeader className="flex flex-row items-center justify-between px-5 pb-0">
                  <CardDescription>{item.label}</CardDescription>
                  <Icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="px-5">
                  <p className="font-heading text-3xl font-semibold tracking-tight">
                    <NumberTicker value={counts[item.key]} />
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">hoje</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle>Filmes prontos</CardTitle>
            <CardDescription>O que a casa entregou nos últimos 7 dias</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={readyChartConfig} className="aspect-auto h-[220px] w-full">
              <AreaChart data={readySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="houseReady" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-prontos)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-prontos)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="prontos"
                  stroke="var(--color-prontos)"
                  strokeWidth={2}
                  fill="url(#houseReady)"
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle>Quando a casa rende</CardTitle>
            <CardDescription>Cortes por horário do turno, nesta semana</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={hourChartConfig} className="aspect-auto h-[220px] w-full">
              <BarChart data={shiftHours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={1}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="cortes" fill="var(--color-cortes)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle>Atenção agora</CardTitle>
            <CardDescription>
              {calm
                ? 'Nada pendente. As câmeras estão no ar.'
                : 'O que precisa de você neste turno.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {attention.length ? (
              attention.map((reel) => (
                <Link
                  key={reel.id}
                  href={`/reels/${reel.id}`}
                  className="flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:bg-muted/40"
                >
                  {reel.status === 'failed' ? (
                    <AlertCircle className="size-4 shrink-0 text-destructive" />
                  ) : (
                    <CheckCircle2 className="size-4 shrink-0 text-primary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {reel.title || reel.moments?.label || 'Filme da casa'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {reel.status === 'failed'
                        ? humanReelFailure(reel.error_code, reel.error_message)
                        : 'Pronto para ver e aprovar'}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                {camerasLive
                  ? 'A casa está calma. Gere um filme quando o salão encher.'
                  : 'Ainda não chegou imagem do gravador.'}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle>Fita</CardTitle>
            <CardDescription>Escolher um instante na gravação</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full rounded-xl">
              <Link href="/recordings">Escolher na fita</Link>
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              Use só se o último take não for o instante certo.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="font-heading text-xl font-semibold tracking-tight">Filme da vez</h3>
            <p className="text-sm text-muted-foreground">O último corte que a casa entregou.</p>
          </div>
          <Link href="/reels" className="text-sm font-medium text-primary hover:underline">
            Ver filmes
          </Link>
        </div>
        {latest ? (
          <ProgramFilm shots={latest.shots} occurredAt={latest.occurredAt} label={latest.label} />
        ) : (
          <div className="space-y-3">
            <ProgramFilm shots={[]} empty />
            <p className="text-sm text-muted-foreground">
              Gere do último take. Um filme Casa — a duração é sua ou da IA.
            </p>
          </div>
        )}
      </section>

      {rest.length ? (
        <section className="space-y-4">
          <h3 className="text-lg font-semibold tracking-tight">Mais do turno</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {rest.map((film) => {
              const shot = film.shots.find((item) => item.thumbnail_path) ?? film.shots[0];
              const time = new Date(film.occurredAt);
              return (
                <Link
                  key={film.momentId}
                  href={shot ? `/reels/${shot.id}` : '/reels'}
                  className={cn(
                    'overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]',
                  )}
                >
                  <div className="relative aspect-[16/10] bg-zinc-950">
                    {shot?.thumbnail_path ? (
                      <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(/api/media/${shot.id}?type=thumbnail)` }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-white/30">
                        <Clapperboard className="size-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 px-4 py-3">
                    <Clock3 className="size-3.5 text-muted-foreground" />
                    <p className="text-sm font-medium tabular-nums">
                      {time.toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone,
                      })}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {film.label || 'Momento da casa'}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
