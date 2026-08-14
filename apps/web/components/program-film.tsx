'use client';

import Link from 'next/link';
import { Clapperboard, Play } from 'lucide-react';
import { editProgramLabels, editPrograms, type EditProgram } from '@reelops/shared';
import { cn } from '@/lib/utils';

export type FilmShot = {
  id: string;
  moment_id?: string | null;
  status: string;
  title: string | null;
  thumbnail_path: string | null;
  output_path: string | null;
  progress?: number | null;
  metadata?: { program?: string } | null;
  created_at?: string;
  moments?: { occurred_at: string; label: string | null } | null;
};

const done = ['ready', 'approved', 'published', 'discarded', 'failed'];

export function programOf(shot: FilmShot): EditProgram | null {
  const value = shot.metadata?.program;
  if (value === 'casa' || value === 'oficio' || value === 'assinatura' || value === 'pulso')
    return value;
  return null;
}

export function groupFilms(shots: FilmShot[]) {
  const map = new Map<string, FilmShot[]>();
  const order: string[] = [];
  for (const shot of shots) {
    const key = shot.moment_id || shot.id;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)?.push(shot);
  }
  return order.map((key) => {
    const items = map.get(key) ?? [];
    const first = items[0];
    return {
      momentId: key,
      occurredAt: first?.moments?.occurred_at ?? first?.created_at ?? new Date().toISOString(),
      label: first?.moments?.label ?? null,
      shots: items,
    };
  });
}

export function ProgramFilm({
  shots,
  occurredAt,
  label,
  activeId,
  empty = false,
}: {
  shots: FilmShot[];
  occurredAt?: string;
  label?: string | null;
  activeId?: string;
  empty?: boolean;
}) {
  const time = occurredAt ? new Date(occurredAt) : null;
  const extras = empty ? [] : shots.filter((item) => !programOf(item));
  let extraCursor = 0;
  const slots = editPrograms.map((program) => {
    const named = empty ? undefined : shots.find((item) => programOf(item) === program);
    if (named) return { program, shot: named };
    const extra = extras[extraCursor];
    if (extra) extraCursor += 1;
    return { program, shot: extra };
  });

  return (
    <article className="overflow-hidden rounded-2xl border bg-zinc-950 text-white shadow-sm">
      <div className="flex items-end justify-between gap-3 px-5 py-4">
        <div>
          {time && !empty ? (
            <p className="font-heading text-3xl font-semibold tabular-nums tracking-tight">
              {time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          ) : (
            <p className="font-heading text-2xl font-semibold tracking-tight">
              Quatro programas. Um instante.
            </p>
          )}
          <p className="mt-1 text-sm text-white/55">
            {empty
              ? 'Casa, Ofício, Assinatura e Pulso saem do mesmo segundo da casa. Ninguém no mercado corta assim.'
              : label ||
                (time
                  ? time.toLocaleDateString('pt-BR', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'short',
                    })
                  : 'Casa · Ofício · Assinatura · Pulso')}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-white/10 md:grid-cols-4">
        {slots.map(({ program, shot }) => {
          if (!shot) {
            return (
              <div key={program} className="relative aspect-[9/16] bg-zinc-950">
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/28">
                  <Clapperboard className="h-5 w-5" />
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em]">
                    {editProgramLabels[program]}
                  </p>
                </div>
              </div>
            );
          }
          const processing = !done.includes(shot.status);
          return (
            <Link
              key={shot.id}
              href={`/reels/${shot.id}`}
              className={cn(
                'group relative aspect-[9/16] bg-zinc-950',
                activeId === shot.id && 'ring-2 ring-inset ring-white',
              )}
            >
              {shot.thumbnail_path ? (
                <div
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                  style={{ backgroundImage: `url(/api/media/${shot.id}?type=thumbnail)` }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/30">
                  <Clapperboard className="h-6 w-6" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/15" />
              {processing ? (
                <p className="absolute inset-x-3 top-1/2 -translate-y-1/2 text-center text-xs text-white/70">
                  Cortando…
                </p>
              ) : shot.output_path ? (
                <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-950">
                    <Play className="h-4 w-4 fill-current" />
                  </span>
                </div>
              ) : null}
              <p className="absolute bottom-3 left-3 text-sm font-semibold">
                {editProgramLabels[program]}
              </p>
            </Link>
          );
        })}
      </div>
    </article>
  );
}
