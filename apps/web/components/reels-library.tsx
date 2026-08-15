'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Film, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { groupFilms, ProgramFilm, type FilmShot } from '@/components/program-film';
import { IN_FLIGHT_STATUSES } from '@/lib/house-today';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'ready' | 'queued' | 'failed' | 'approved' | 'published';

const filters: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Tudo' },
  { id: 'ready', label: 'Para o ar' },
  { id: 'queued', label: 'Na fila' },
  { id: 'failed', label: 'Falhou' },
  { id: 'approved', label: 'Aprovados' },
  { id: 'published', label: 'Publicados' },
];

function matchesFilter(status: string, filter: Filter) {
  if (filter === 'all') return true;
  if (filter === 'queued')
    return IN_FLIGHT_STATUSES.includes(status as (typeof IN_FLIGHT_STATUSES)[number]);
  return status === filter;
}

export default function ReelsLibrary({ reels }: { reels: FilmShot[] }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get('status');
  const initial: Filter = filters.some((item) => item.id === requested)
    ? (requested as Filter)
    : 'all';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(initial);

  const films = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    const matched = reels.filter((reel) => {
      if (!matchesFilter(reel.status, filter)) return false;
      if (!needle) return true;
      const haystack = `${reel.title ?? ''} ${reel.moments?.label ?? ''}`.toLocaleLowerCase(
        'pt-BR',
      );
      return haystack.includes(needle);
    });
    return groupFilms(matched);
  }, [reels, query, filter]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-96">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar pelo instante…"
            className="h-10 w-full rounded-md border border-input bg-background pr-4 pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cn(
                'inline-flex shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                filter === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {!films.length ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="flex flex-col items-center justify-center p-16 text-center">
            <Film className="mb-4 h-8 w-8 text-primary" />
            <h3 className="text-xl font-semibold">
              {reels.length ? 'Nada neste filtro' : 'Ainda não há filme'}
            </h3>
            <p className="mt-2 mb-6 max-w-sm text-sm text-muted-foreground">
              {reels.length
                ? 'Limpe o filtro para ver os instantes.'
                : 'Gere do último take. Um filme por momento.'}
            </p>
            {reels.length ? (
              <Button
                variant="outline"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Ver tudo
              </Button>
            ) : (
              <Button asChild>
                <Link href="/">Gerar do último take</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {films.map((film) => (
            <ProgramFilm
              key={film.momentId}
              shots={film.shots}
              occurredAt={film.occurredAt}
              label={film.label}
            />
          ))}
        </div>
      )}
    </div>
  );
}
