import {
  activeSequence,
  clipDurationMs,
  createEntityId,
  intensityForAutomationMode,
  sequenceDurationMs,
  type AiDecision,
  type AutomationMode,
  type VideoProject,
} from './video-project.js';
import {
  addMediaAndClip,
  appendAiDecisions,
  deleteClip,
  MIN_CLIP_MS,
  packTrackClips,
  patchClip,
  trimClip,
} from './video-project-ops.js';

export const aiEditorCommands = [
  { id: 'auto_edit', label: 'Editar automaticamente' },
  { id: 'improve_cuts', label: 'Melhorar cortes' },
  { id: 'improve_pace', label: 'Melhorar ritmo' },
  { id: 'find_best', label: 'Encontrar melhores momentos' },
  { id: 'remove_weak', label: 'Remover momentos ruins' },
  { id: 'create_hook', label: 'Criar hook' },
  { id: 'add_broll', label: 'Adicionar B-roll' },
  { id: 'auto_zoom', label: 'Criar zoom automático' },
  { id: 'create_captions', label: 'Criar legendas' },
  { id: 'remove_silence', label: 'Remover silêncios' },
  { id: 'create_reel', label: 'Criar Reel' },
  { id: 'create_story', label: 'Criar Story' },
] as const;

export type AiEditorCommandId = (typeof aiEditorCommands)[number]['id'];

export type AiEditorResult = {
  project: VideoProject;
  message: string;
  changed: boolean;
};

function videoClips(project: VideoProject) {
  return (
    activeSequence(project)
      .tracks.find((track) => track.id === 'track_v1')
      ?.clips.filter((clip) => !clip.disabled)
      .sort((a, b) => a.timelineStartMs - b.timelineStartMs) ?? []
  );
}

function decision(
  atMs: number,
  kind: AiDecision['kind'],
  reason: string,
  extra?: Partial<AiDecision>,
): AiDecision {
  return {
    id: createEntityId('dec'),
    atMs,
    kind,
    reason,
    ...extra,
  };
}

function withQuality(project: VideoProject): VideoProject {
  const clips = videoClips(project);
  const duration = sequenceDurationMs(activeSequence(project));
  const scores = clips.map((clip) => clip.ai?.score ?? 70);
  const avg = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 70;
  const hook = scores[0] ?? 70;
  const lengths = clips.map((clip) => clipDurationMs(clip) / 1000);
  const mean = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
  const variance = lengths.length
    ? lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length
    : 0;
  const pacing = Math.max(40, Math.min(100, Math.round(100 - Math.sqrt(variance) * 8)));
  const cuts = Math.max(
    50,
    Math.min(100, Math.round(88 - Math.abs(clips.length - Math.max(2, duration / 8000)) * 6)),
  );
  const originalMuted = Boolean(
    activeSequence(project).tracks.find((track) => track.id === 'track_a1')?.muted,
  );
  const audio = originalMuted ? 62 : clips.some((clip) => clip.muted) ? 74 : 84;
  const cameras = new Set(clips.map((clip) => clip.mediaId));
  const continuity = cameras.size <= 1 ? 90 : cameras.size === 2 ? 82 : 74;
  const overall = Math.round(
    hook * 0.18 + pacing * 0.18 + cuts * 0.18 + avg * 0.2 + audio * 0.12 + continuity * 0.14,
  );
  return {
    ...project,
    ai: {
      mode: project.ai?.mode ?? 'balanced',
      decisions: project.ai?.decisions ?? [],
      unusedMediaIds: project.ai?.unusedMediaIds ?? [],
      renderFromProject: true,
      quality: {
        overall,
        hook: Math.round(hook),
        pacing,
        cuts,
        visual: Math.round(avg),
        audio,
        continuity,
      },
    },
  };
}

function maxClipMs(mode: AutomationMode) {
  if (mode === 'aggressive') return 3800;
  if (mode === 'dynamic') return 5500;
  if (mode === 'conservative') return 14000;
  if (mode === 'cinematic') return 16000;
  return 9000;
}

function tightenUnlocked(project: VideoProject, amountMs: number, reason: string): VideoProject {
  let next = project;
  const rows: AiDecision[] = [];
  for (const clip of videoClips(project)) {
    if (clip.lockedByUser) continue;
    const duration = clipDurationMs(clip);
    if (duration <= amountMs + MIN_CLIP_MS + 400) continue;
    const trimmed = trimClip(next, clip.id, 'right', clip.timelineEndMs - amountMs);
    if (!trimmed) continue;
    next = trimmed;
    rows.push(
      decision(clip.timelineStartMs, 'trim', reason, {
        clipId: clip.id,
        mediaId: clip.mediaId ?? undefined,
        detail: `sourceOut ${((clip.sourceOutMs - amountMs) / 1000).toFixed(2)}s`,
      }),
    );
  }
  return rows.length ? appendAiDecisions(next, rows) : next;
}

function capUnlockedDuration(project: VideoProject, capMs: number): VideoProject {
  let next = project;
  const rows: AiDecision[] = [];
  for (const clip of videoClips(project)) {
    if (clip.lockedByUser) continue;
    const duration = clipDurationMs(clip);
    if (duration <= capMs) continue;
    const trimmed = trimClip(next, clip.id, 'right', clip.timelineStartMs + capMs);
    if (!trimmed) continue;
    next = trimmed;
    rows.push(
      decision(
        clip.timelineStartMs,
        'trim',
        `Ritmo: clip limitado a ${(capMs / 1000).toFixed(1)}s`,
        {
          clipId: clip.id,
          mediaId: clip.mediaId ?? undefined,
        },
      ),
    );
  }
  return rows.length ? packTrackClips(appendAiDecisions(next, rows), 'track_v1') : next;
}

function setAspectReel(project: VideoProject, label: string): VideoProject {
  return appendAiDecisions(
    {
      ...project,
      settings: {
        ...project.settings,
        aspect: '9:16',
        width: 1080,
        height: 1920,
      },
      updatedAt: new Date().toISOString(),
    },
    [decision(0, 'crop', `${label}: canvas 9:16 1080×1920`)],
  );
}

export function applyAiEditorCommand(
  project: VideoProject,
  command: AiEditorCommandId,
): AiEditorResult {
  const mode = project.ai?.mode ?? 'balanced';
  const intensity = intensityForAutomationMode(mode);

  if (command === 'create_reel' || command === 'create_story') {
    const label = command === 'create_story' ? 'Story' : 'Reel';
    const next = withQuality(setAspectReel(project, label));
    return { project: next, changed: true, message: `${label} 9:16 aplicado ao projeto.` };
  }

  if (command === 'improve_cuts') {
    const next = withQuality(tightenUnlocked(project, 180, 'Corte apertado no final do take'));
    return {
      project: next,
      changed: next !== project,
      message: 'Cortes apertados nos clips desbloqueados.',
    };
  }

  if (command === 'improve_pace') {
    const next = withQuality(capUnlockedDuration(project, maxClipMs(mode)));
    return {
      project: next,
      changed: true,
      message: `Ritmo ${mode}: clips desbloqueados limitados.`,
    };
  }

  if (command === 'remove_silence') {
    const next = withQuality(
      tightenUnlocked(
        capUnlockedDuration(project, 10_000),
        400,
        'Trecho longo encurtado na timeline (arquivo original intacto)',
      ),
    );
    return {
      project: next,
      changed: true,
      message: 'Silêncios/trechos longos viraram cortes na timeline. Desfazer restaura.',
    };
  }

  if (command === 'remove_weak') {
    let next = project;
    const rows: AiDecision[] = [];
    const threshold = 55 - Math.round(intensity * 8);
    for (const clip of videoClips(project)) {
      if (clip.lockedByUser) continue;
      if ((clip.ai?.score ?? 70) >= threshold) continue;
      if (videoClips(next).length <= 1) break;
      const deleted = deleteClip(next, clip.id, true);
      if (!deleted) continue;
      next = deleted;
      rows.push(
        decision(clip.timelineStartMs, 'cut', 'Take fraco removido da timeline', {
          clipId: clip.id,
          mediaId: clip.mediaId ?? undefined,
          detail: `score ${clip.ai?.score ?? 0} < ${threshold}`,
        }),
      );
    }
    const packed = rows.length
      ? packTrackClips(appendAiDecisions(next, rows), 'track_v1')
      : appendAiDecisions(next, [
          decision(0, 'cut', 'Nenhum clip desbloqueado abaixo do limiar de qualidade'),
        ]);
    return {
      project: withQuality(packed),
      changed: rows.length > 0,
      message: rows.length
        ? `${rows.length} clip(s) fraco(s) saíram da timeline.`
        : 'Nada fraco o bastante para remover.',
    };
  }

  if (command === 'auto_zoom') {
    let next = project;
    const rows: AiDecision[] = [];
    for (const clip of videoClips(project)) {
      if (clip.lockedByUser || clip.motion !== 'none') continue;
      const patched = patchClip(next, clip.id, {
        motion: 'slow_push',
        transform: { ...clip.transform, scale: Math.max(clip.transform.scale, 1.04) },
      });
      if (!patched) continue;
      next = patched;
      rows.push(
        decision(clip.timelineStartMs, 'zoom', 'Slow push 1.00 → 1.04', {
          clipId: clip.id,
          mediaId: clip.mediaId ?? undefined,
        }),
      );
    }
    return {
      project: withQuality(rows.length ? appendAiDecisions(next, rows) : next),
      changed: rows.length > 0,
      message: rows.length ? 'Zoom automático nos clips desbloqueados.' : 'Nada para animar.',
    };
  }

  if (command === 'create_captions') {
    if (project.captions.length) {
      return { project, changed: false, message: 'Já existem legendas editáveis neste projeto.' };
    }
    const captions = videoClips(project).map((clip) => ({
      id: createEntityId('cap'),
      startMs: clip.timelineStartMs,
      endMs: Math.min(clip.timelineEndMs, clip.timelineStartMs + 4000),
      text: clip.ai?.reason || clip.name,
    }));
    const next = appendAiDecisions({ ...project, captions, updatedAt: new Date().toISOString() }, [
      decision(0, 'caption', `${captions.length} cue(s) gerados a partir dos takes`),
    ]);
    return {
      project: withQuality(next),
      changed: captions.length > 0,
      message: 'Legendas criadas na timeline. Edite o texto no painel.',
    };
  }

  if (command === 'create_hook') {
    const clips = videoClips(project);
    if (!clips.length) return { project, changed: false, message: 'Timeline vazia.' };
    if (clips.some((clip) => clip.lockedByUser)) {
      return {
        project,
        changed: false,
        message: 'Há clips bloqueados. O hook automático não reordena a V1.',
      };
    }
    const ranked = [...clips].sort((a, b) => (b.ai?.score ?? 0) - (a.ai?.score ?? 0));
    const best = ranked[0]!;
    if (best.id === clips[0]?.id) {
      const next = appendAiDecisions(project, [
        decision(0, 'select_take', 'Hook já é o take mais forte', { clipId: best.id }),
      ]);
      return {
        project: withQuality(next),
        changed: false,
        message: 'O primeiro clip já é o hook.',
      };
    }
    const track = activeSequence(project).tracks.find((item) => item.id === 'track_v1');
    if (!track) return { project, changed: false, message: 'Track V1 ausente.' };
    const reordered = [best, ...clips.filter((clip) => clip.id !== best.id)];
    let cursor = 0;
    const packed = reordered.map((clip) => {
      const duration = clipDurationMs(clip);
      const next = { ...clip, timelineStartMs: cursor, timelineEndMs: cursor + duration };
      cursor += duration;
      return next;
    });
    const next = appendAiDecisions(
      {
        ...project,
        sequences: [
          {
            ...activeSequence(project),
            tracks: activeSequence(project).tracks.map((item) =>
              item.id === 'track_v1' ? { ...item, clips: packed } : item,
            ),
          },
          ...project.sequences.slice(1),
        ],
        updatedAt: new Date().toISOString(),
      },
      [
        decision(0, 'reorder', `Hook: ${best.name} foi para 00:00`, {
          clipId: best.id,
          mediaId: best.mediaId ?? undefined,
        }),
      ],
    );
    return { project: withQuality(next), changed: true, message: `${best.name} virou o gancho.` };
  }

  if (command === 'find_best' || command === 'add_broll') {
    const unusedIds = new Set(project.ai?.unusedMediaIds ?? []);
    const unused = project.media
      .filter(
        (item) =>
          item.kind === 'video' &&
          (unusedIds.has(item.id) ||
            item.takeStatus === 'available' ||
            item.takeStatus === 'rejected'),
      )
      .sort((a, b) => (b.scores?.overall ?? 0) - (a.scores?.overall ?? 0));
    const pick = unused[0];
    if (!pick) {
      return {
        project,
        changed: false,
        message: 'Não há mídia fora da timeline para adicionar.',
      };
    }
    const duration = Math.min(pick.durationMs || 2500, command === 'add_broll' ? 2500 : 4000);
    const next = addMediaAndClip(project, pick, {
      trackId: command === 'add_broll' ? 'track_v2' : 'track_v1',
      sourceInMs: 0,
      sourceOutMs: Math.max(MIN_CLIP_MS, duration),
    });
    const logged = appendAiDecisions(next, [
      decision(
        sequenceDurationMs(activeSequence(project)),
        'select_take',
        command === 'add_broll'
          ? `B-roll ${pick.name} na V2`
          : `${pick.name} adicionado a partir da mídia não usada`,
        { mediaId: pick.id },
      ),
    ]);
    return {
      project: withQuality(logged),
      changed: true,
      message:
        command === 'add_broll'
          ? `${pick.name} entrou como overlay na V2.`
          : `${pick.name} entrou na V1 a partir dos takes não usados.`,
    };
  }

  if (command === 'auto_edit') {
    const paced = capUnlockedDuration(project, maxClipMs(mode));
    const zoomed = applyAiEditorCommand(paced, 'auto_zoom').project;
    const captioned =
      zoomed.captions.length === 0
        ? applyAiEditorCommand(zoomed, 'create_captions').project
        : zoomed;
    const next = appendAiDecisions(withQuality(captioned), [
      decision(0, 'select_take', `Edição automática (${mode}) aplicada à timeline, não ao MP4`),
    ]);
    return {
      project: next,
      changed: true,
      message: 'Automação atualizou a timeline. O MP4 só nasce no export.',
    };
  }

  return { project, changed: false, message: 'Comando desconhecido.' };
}
