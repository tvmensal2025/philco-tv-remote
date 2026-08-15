'use client';

import {
  activeSequence,
  parseVideoProject,
  setTransitionIn,
  type VideoProject,
} from '@reelops/shared';
import { Clapperboard, Scissors } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  humanAnalysis,
  houseCutTakes,
  isDissolveTransition,
  type ReelCutMetadata,
} from '@/lib/house-cut';
import { cn } from '@/lib/utils';

function formatSeconds(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${value >= 10 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')}s`;
}

function projectClips(project: VideoProject) {
  const video =
    activeSequence(project).tracks.find((track) => track.kind === 'video') ??
    activeSequence(project).tracks[0];
  return (video?.clips ?? []).filter((clip) => clip.kind === 'video');
}

export default function HouseCutBoard({
  reelId,
  metadata,
  canEdit,
  onQueued,
}: {
  reelId: string;
  metadata?: ReelCutMetadata | null;
  canEdit: boolean;
  onQueued?: () => void;
}) {
  const parsed = useMemo(
    () => (metadata?.video_project ? parseVideoProject(metadata.video_project) : null),
    [metadata?.video_project],
  );
  const initialProject = parsed?.success ? parsed.data : null;
  const [project, setProject] = useState<VideoProject | null>(initialProject);
  const [busy, setBusy] = useState(false);
  const analysis = humanAnalysis(metadata);
  const fallbackTakes = houseCutTakes(metadata);
  const clips = project ? projectClips(project) : [];
  const enabledCount = clips.filter((clip) => !clip.disabled).length;
  const hasScenes = clips.length > 0 || fallbackTakes.length > 0;
  const canApply = Boolean(project && canEdit && enabledCount > 0);

  function toggleClip(clipId: string, enabled: boolean) {
    if (!project) return;
    setProject({
      ...project,
      sequences: project.sequences.map((sequence, index) =>
        index !== 0
          ? sequence
          : {
              ...sequence,
              tracks: sequence.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) =>
                  clip.id === clipId ? { ...clip, disabled: !enabled } : clip,
                ),
              })),
            },
      ),
    });
  }

  function setJoin(clipId: string, dissolve: boolean) {
    if (!project) return;
    const next = setTransitionIn(project, clipId, dissolve ? 'cross_dissolve' : 'cut', 500);
    if (next) setProject(next);
  }

  async function apply() {
    if (!project || !canApply) return;
    setBusy(true);
    const response = await fetch(`/api/editor/${reelId}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      toast.error(typeof result.error === 'string' ? result.error : 'Não foi possível recortar.');
      return;
    }
    toast.success('Recortando. O filme novo aparece aqui.');
    onQueued?.();
  }

  if (!analysis.analysis && !analysis.use && !hasScenes) return null;

  return (
    <section className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm">
      <div>
        <h3 className="text-base font-semibold tracking-tight">Como ficou o corte</h3>
        <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          {analysis.analysis ? <p>{analysis.analysis}</p> : null}
          {analysis.use ? <p>{analysis.use}</p> : null}
          {analysis.confidence ? <p>{analysis.confidence}</p> : null}
        </div>
      </div>

      {hasScenes ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Cenas</p>
          <ul className="space-y-3">
            {clips.length
              ? clips.map((clip, index) => {
                  const media = project?.media.find((item) => item.id === clip.mediaId);
                  const dissolve = isDissolveTransition(clip.transitionIn?.type);
                  const seconds = (clip.sourceOutMs - clip.sourceInMs) / 1000 / (clip.speed || 1);
                  return (
                    <li
                      key={clip.id}
                      className={cn('rounded-xl border p-4', clip.disabled && 'opacity-55')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {clip.ai?.reason || clip.name || `Cena ${index + 1}`}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {[media?.cameraLabel, formatSeconds(seconds)]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        <Switch
                          checked={!clip.disabled}
                          disabled={!canEdit || busy}
                          onCheckedChange={(checked) => toggleClip(clip.id, checked)}
                          aria-label={clip.disabled ? 'Ligar cena' : 'Desligar cena'}
                        />
                      </div>
                      {index > 0 && !clip.disabled ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={dissolve ? 'outline' : 'secondary'}
                            disabled={!canEdit || busy}
                            onClick={() => setJoin(clip.id, false)}
                          >
                            Corte
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={dissolve ? 'secondary' : 'outline'}
                            disabled={!canEdit || busy}
                            onClick={() => setJoin(clip.id, true)}
                          >
                            Dissolve
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  );
                })
              : fallbackTakes.map((take, index) => (
                  <li key={take.id} className="rounded-xl border p-4">
                    <p className="text-sm font-medium">{take.reason || `Cena ${index + 1}`}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[
                        take.camera,
                        formatSeconds(take.duration),
                        isDissolveTransition(take.transition) ? 'Dissolve' : 'Corte',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </li>
                ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {project ? (
          <Button onClick={() => void apply()} disabled={!canApply || busy}>
            <Scissors className="mr-2 h-4 w-4" />
            Aplicar e recortar
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/editor/${reelId}`}>
            <Clapperboard className="mr-2 h-4 w-4" />
            Abrir no editor
          </Link>
        </Button>
      </div>
    </section>
  );
}
