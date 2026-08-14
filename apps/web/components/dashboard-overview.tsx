'use client';

import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { groupFilms, ProgramFilm, type FilmShot } from '@/components/program-film';

type Restaurant = { id: string; name: string; timezone: string; settings: Record<string, unknown> };
type Camera = { id: string; restaurant_id: string; last_seen_at: string | null; enabled: boolean };

export default function DashboardOverview({
  initialReels,
  restaurants,
  cameras,
  role,
  runtimeConfig,
}: {
  initialReels: FilmShot[];
  restaurants: Restaurant[];
  cameras: Camera[];
  role: string;
  runtimeConfig: { supabaseUrl: string; supabaseAnonKey: string };
}) {
  const router = useRouter();
  const [reels, setReels] = useState(initialReels);
  const [busy, setBusy] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const supabase = useMemo(
    () => createBrowserClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey),
    [runtimeConfig],
  );
  const canEdit = role !== 'viewer';
  const restaurantId = restaurants[0]?.id ?? '';
  const restaurantName = restaurants[0]?.name || 'A casa';
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

  async function refresh() {
    const response = await fetch('/api/reels', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data.reels)) {
      setReels(data.reels.filter((reel: FilmShot) => reel.status !== 'discarded'));
    }
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
    toast.success('Quatro programas na fila');
    if (reelId) router.push(`/reels/${reelId}`);
    else router.push('/moments');
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            CenaPronta
          </p>
          <h2 className="mt-1 font-heading text-3xl font-semibold tracking-tight">
            {restaurantName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {houseCameras.length} câmeras na sala
            {lastSeen
              ? ` · última imagem às ${new Date(lastSeen).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : ' · aguardando o gravador'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg" className="h-11 rounded-xl">
            <Link href="/recordings">Abrir a sala</Link>
          </Button>
          {canEdit ? (
            <Button
              size="lg"
              variant="outline"
              className="h-11 rounded-xl"
              onClick={() => void mark()}
              disabled={busy || !restaurantId}
            >
              {busy ? 'Gerando…' : 'Gerar do último take'}
            </Button>
          ) : null}
        </div>
      </div>

      {latest ? (
        <ProgramFilm shots={latest.shots} occurredAt={latest.occurredAt} label={latest.label} />
      ) : (
        <div className="space-y-4">
          <ProgramFilm shots={[]} empty />
          <p className="text-sm text-muted-foreground">
            Abra a sala, escolha o instante e gere. Os quatro filmes nascem juntos — não um clipe
            por câmera.
          </p>
        </div>
      )}

      {rest.length ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold tracking-tight">Mais do turno</h3>
            <Link href="/moments" className="text-sm font-medium text-primary hover:underline">
              Ver o turno
            </Link>
          </div>
          <div className="space-y-6">
            {rest.map((film) => (
              <ProgramFilm
                key={film.momentId}
                shots={film.shots}
                occurredAt={film.occurredAt}
                label={film.label}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
