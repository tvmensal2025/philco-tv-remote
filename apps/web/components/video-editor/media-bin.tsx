'use client';

import { useMemo, useState } from 'react';
import {
  takeStatusLabel,
  type MediaAsset,
  type TakeStatus,
  type ProjectClip,
  type TransitionType,
  type VideoProject,
  transitionLabels,
  transitionTypes,
  motionPresets,
} from '@reelops/shared';
import { cn } from '@/lib/utils';

const statusTone: Record<TakeStatus, string> = {
  used: 'text-emerald-400',
  available: 'text-[#8d97a8]',
  rejected: 'text-rose-400',
  duplicate: 'text-amber-400',
  low_quality: 'text-orange-400',
  incoherent: 'text-rose-300',
  ai_selected: 'text-[#d4a24c]',
};

export function MediaBin({
  project,
  tab,
  unusedOnly,
  onAdd,
  onAddRange,
}: {
  project: VideoProject;
  tab: 'media' | 'takes' | 'unused';
  unusedOnly?: boolean;
  onAdd: (media: MediaAsset, whole: boolean) => void;
  onAddRange?: (media: MediaAsset, inMs: number, outMs: number) => void;
}) {
  const [query, setQuery] = useState('');
  const unused = new Set(project.ai?.unusedMediaIds ?? []);
  const items = useMemo(() => {
    return project.media.filter((item) => {
      if (tab === 'takes' && !item.cameraPosition) return false;
      if (tab === 'unused' || unusedOnly)
        return (
          unused.has(item.id) || item.takeStatus === 'rejected' || item.takeStatus === 'available'
        );
      if (query && !item.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [project.media, query, tab, unused, unusedOnly]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar mídia"
        className="m-2 h-7 rounded border border-[#232a36] bg-[#0b0d11] px-2 text-[11px] outline-none"
      />
      <div className="nle-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {items.length === 0 ? (
          <p className="px-1 py-6 text-center text-[11px] text-[#8d97a8]">
            {tab === 'unused' ? 'Nada ficou de fora.' : 'Solte arquivos aqui ou importe takes.'}
          </p>
        ) : null}
        {items.map((item) => (
          <article
            key={item.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-cenapronta-media', item.id);
              event.dataTransfer.effectAllowed = 'copy';
            }}
            className="group cursor-grab rounded-sm border border-[#262d3a] bg-[#161b24] p-2 hover:border-[#d4a24c]/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium">{item.name}</p>
                <p className="text-[10px] text-[#8d97a8]">
                  {item.cameraLabel ?? item.kind}
                  {item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ''}
                  {item.width ? ` · ${item.width}×${item.height}` : ''}
                </p>
              </div>
              <span className={cn('text-[10px]', statusTone[item.takeStatus])}>
                {takeStatusLabel(item.takeStatus)}
              </span>
            </div>
            {item.scores?.overall != null ? (
              <p className="mt-1 text-[10px] text-[#8d97a8]">
                IA {item.scores.overall}
                {item.scores.quality != null ? ` · Q ${item.scores.quality}` : ''}
                {item.scores.motion != null ? ` · M ${item.scores.motion}` : ''}
              </p>
            ) : null}
            {item.rejectReason ? (
              <p className="mt-1 text-[10px] text-rose-300/90">{item.rejectReason}</p>
            ) : null}
            <div className="mt-2 flex gap-1 opacity-80 group-hover:opacity-100">
              <button
                type="button"
                className="h-6 rounded border border-[#232a36] px-2 text-[10px] hover:bg-[#232a36]"
                onClick={() => onAdd(item, true)}
              >
                Take inteiro
              </button>
              {onAddRange && item.durationMs > 0 ? (
                <button
                  type="button"
                  className="h-6 rounded border border-[#232a36] px-2 text-[10px] hover:bg-[#232a36]"
                  onClick={() => onAddRange(item, 0, Math.min(item.durationMs, 4000))}
                >
                  Trecho 4s
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function EffectsBin({
  onMotion,
}: {
  onMotion: (preset: (typeof motionPresets)[number]) => void;
}) {
  return (
    <div className="nle-scroll h-full space-y-3 overflow-y-auto p-2 text-[11px]">
      <section>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-[#8d97a8]">Motion</p>
        <div className="grid grid-cols-2 gap-1">
          {motionPresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className="rounded border border-[#232a36] bg-[#181c24] px-2 py-1.5 text-left hover:border-[#d4a24c]/50"
              onClick={() => onMotion(preset)}
            >
              {preset.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
      </section>
      <p className="text-[#8d97a8]">
        Transform, speed e cor ficam no inspector do clip selecionado. Novos efeitos entram neste
        catálogo sem mudar a timeline.
      </p>
    </div>
  );
}

export function TransitionsBin({ onPick }: { onPick: (type: TransitionType) => void }) {
  return (
    <div className="nle-scroll grid h-full grid-cols-2 content-start gap-1 overflow-y-auto p-2">
      {transitionTypes.map((type) => (
        <button
          key={type}
          type="button"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-cenapronta-transition', type);
            event.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => onPick(type)}
          className="rounded border border-[#232a36] bg-[#181c24] px-2 py-2 text-left text-[11px] hover:border-[#d4a24c]/50"
        >
          <span className="block h-8 rounded-sm bg-gradient-to-r from-[#2a3140] via-white/40 to-[#2a3140] mb-1.5" />
          {transitionLabels[type]}
        </button>
      ))}
    </div>
  );
}

export function WaveformBars({ peaks, className }: { peaks: number[] | null; className?: string }) {
  if (!peaks) {
    return (
      <div className={cn('h-8 rounded-sm bg-[#1a2030]', className)} title="Waveform indisponível" />
    );
  }
  return (
    <div className={cn('flex h-8 items-end gap-px', className)}>
      {peaks.map((peak, index) => (
        <span
          key={index}
          className="flex-1 bg-[#6ea8ff]/80"
          style={{ height: `${Math.max(8, peak * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function selectedClipOf(project: VideoProject, clipId: string | null): ProjectClip | null {
  if (!clipId) return null;
  for (const track of project.sequences[0]?.tracks ?? []) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return clip;
  }
  return null;
}
