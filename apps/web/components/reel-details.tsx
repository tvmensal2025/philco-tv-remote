'use client';

import { ArrowLeft, Download, Share2, CheckCircle2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProgramFilm, programOf, type FilmShot } from '@/components/program-film';
import { editProgramLabels } from '@reelops/shared';

const statusLabel: Record<string, string> = {
  queued: 'Na fila',
  collecting: 'Coletando',
  analyzing: 'Analisando',
  rendering: 'Cortando',
  uploading: 'Enviando',
  ready: 'Pronto',
  approved: 'Aprovado',
  publishing: 'Publicando',
  published: 'No ar',
  discarded: 'Descartado',
  failed: 'Falhou',
};

export default function ReelDetails({
  reel,
  siblings,
  instagramEnabled,
}: {
  reel: FilmShot & { restaurants?: { name: string } | null; output_path: string | null };
  siblings: FilmShot[];
  instagramEnabled: boolean;
}) {
  const [status, setStatus] = useState(reel.status);
  const [busy, setBusy] = useState<string | null>(null);
  const program = programOf(reel);
  const occurred = reel.moments?.occurred_at ?? reel.created_at;
  const canDownload =
    Boolean(reel.output_path) && ['ready', 'approved', 'published'].includes(status);

  async function run(action: 'approve' | 'discard' | 'publish' | 'retry') {
    setBusy(action);
    const response = await fetch(`/api/reels/${reel.id}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const result = await response.json();
    setBusy(null);
    if (!response.ok) {
      toast.error(result.error ?? 'Não foi possível concluir.');
      return;
    }
    if (action === 'approve') setStatus('approved');
    if (action === 'discard') setStatus('discarded');
    if (action === 'publish') setStatus('publishing');
    if (action === 'retry') setStatus('queued');
    toast.success(
      action === 'approve'
        ? 'Aprovado.'
        : action === 'discard'
          ? 'Descartado.'
          : action === 'publish'
            ? 'Enviado ao Instagram.'
            : 'Na fila de novo.',
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <Button variant="ghost" size="icon" asChild className="rounded-full">
          <Link href="/reels">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">
              {program ? editProgramLabels[program] : reel.title || 'Reel'}
            </h2>
            <Badge variant="secondary">{statusLabel[status] ?? status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {reel.restaurants?.name}
            {occurred
              ? ` · ${new Date(occurred).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status === 'ready' ? (
            <Button onClick={() => void run('approve')} disabled={Boolean(busy)}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Aprovar
            </Button>
          ) : null}
          {status === 'approved' && instagramEnabled ? (
            <Button onClick={() => void run('publish')} disabled={Boolean(busy)}>
              <Share2 className="mr-2 h-4 w-4" /> Publicar
            </Button>
          ) : null}
          {status === 'failed' ? (
            <Button variant="outline" onClick={() => void run('retry')} disabled={Boolean(busy)}>
              Tentar de novo
            </Button>
          ) : null}
          {['ready', 'approved', 'failed'].includes(status) ? (
            <Button variant="outline" onClick={() => void run('discard')} disabled={Boolean(busy)}>
              <Trash2 className="mr-2 h-4 w-4" /> Descartar
            </Button>
          ) : null}
          {canDownload ? (
            <Button variant="outline" asChild>
              <a href={`/api/media/${reel.id}?download=1`}>
                <Download className="mr-2 h-4 w-4" /> Baixar MP4
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-3xl bg-zinc-950 shadow-2xl">
          {reel.output_path && ['ready', 'approved', 'published', 'publishing'].includes(status) ? (
            <video
              controls
              playsInline
              src={`/api/media/${reel.id}`}
              poster={reel.thumbnail_path ? `/api/media/${reel.id}?type=thumbnail` : undefined}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-white/70">
              <p className="text-sm font-medium">{statusLabel[status] ?? 'Cortando'}</p>
              <p className="text-xs text-white/45">O MP4 aparece aqui quando o corte termina.</p>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">O mesmo instante, nos outros programas.</p>
          <ProgramFilm
            shots={siblings.length ? siblings : [reel]}
            occurredAt={occurred}
            label={reel.moments?.label}
            activeId={reel.id}
          />
        </div>
      </div>
    </div>
  );
}
