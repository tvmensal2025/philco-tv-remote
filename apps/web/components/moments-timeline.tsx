'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Clapperboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { groupFilms, ProgramFilm, type FilmShot } from '@/components/program-film';

function isSameDay(value: string, offsetDays: number) {
  const date = new Date(value);
  const target = new Date();
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() - offsetDays);
  const ts = date.getTime();
  return ts >= target.getTime() && ts < target.getTime() + 86_400_000;
}

export default function MomentsTimeline({ shots }: { shots: FilmShot[] }) {
  const [filter, setFilter] = useState(() =>
    shots.some((shot) => isSameDay(shot.moments?.occurred_at ?? shot.created_at ?? '', 0))
      ? 'hoje'
      : 'tudo',
  );
  const now = useMemo(() => Date.now(), []);
  const films = useMemo(() => {
    const grouped = groupFilms(shots);
    return grouped.filter((film) => {
      if (filter === 'hoje') return isSameDay(film.occurredAt, 0);
      if (filter === 'ontem') return isSameDay(film.occurredAt, 1);
      if (filter === 'semana') return now - Date.parse(film.occurredAt) <= 7 * 86_400_000;
      return true;
    });
  }, [shots, filter, now]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'hoje', label: 'Hoje' },
          { id: 'ontem', label: 'Ontem' },
          { id: 'semana', label: '7 dias' },
          { id: 'tudo', label: 'Tudo' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              filter === item.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {films.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/20 px-6 py-20 text-center">
          <Clapperboard className="mx-auto mb-4 h-8 w-8 text-primary" />
          <h3 className="text-xl font-semibold tracking-tight">O turno ainda não virou filme</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Abra a sala e gere. Cada instante aparece aqui com Casa, Ofício, Assinatura e Pulso.
          </p>
          <Button asChild className="mt-6">
            <Link href="/recordings">Abrir a sala</Link>
          </Button>
        </div>
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
