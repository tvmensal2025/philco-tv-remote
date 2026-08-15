'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  activeSequence,
  addMediaAndClip,
  createEmptyProject,
  createHistory,
  createEntityId,
  deleteClip,
  detachAudio,
  duplicateClip,
  insertClipAt,
  makeVideoClip,
  moveClip,
  muteTrack,
  patchClip,
  pushHistory,
  redoProject,
  sequenceDurationMs,
  setClipLocked,
  setTransitionIn,
  snapTimeMs,
  splitClipAtPlayhead,
  transitionTypes,
  trimClip,
  undoProject,
  type AutomationMode,
  type MediaAsset,
  type TransitionType,
  type VideoProject,
} from '@reelops/shared';
import { ArrowLeft, Film, Minus, Plus, Redo2, Scissors, Sparkles, Undo2 } from 'lucide-react';
import PreviewMonitor from './preview-monitor';
import PlayerBar from './player-bar';
import EditorTimeline from './editor-timeline';
import ClipInspector from './clip-inspector';
import AiPanel from './ai-panel';
import { EffectsBin, MediaBin, TransitionsBin, selectedClipOf } from './media-bin';
import { getPlayback, resetPlayback, setPlayback } from './playback-store';
import { matchEditorShortcut } from './shortcuts';
import { cn } from '@/lib/utils';

type LeftTab =
  'media' | 'takes' | 'effects' | 'transitions' | 'audio' | 'captions' | 'ai' | 'unused';
type RightTab = 'inspector' | 'ai';
type SaveState = 'saved' | 'saving' | 'dirty';

function withAiMode(project: VideoProject, mode: AutomationMode): VideoProject {
  return {
    ...project,
    ai: {
      mode,
      decisions: project.ai?.decisions ?? [],
      unusedMediaIds: project.ai?.unusedMediaIds ?? [],
      quality: project.ai?.quality,
      renderFromProject: project.ai?.renderFromProject ?? false,
    },
  };
}

function readDuration(file: File) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    video.src = url;
  });
}

export default function VideoEditor({
  initial,
  reelId,
  title,
}: {
  initial: VideoProject;
  reelId?: string;
  title?: string;
}) {
  const [project, setProject] = useState(initial);
  const [history, setHistory] = useState(createHistory);
  const [selectedId, setSelectedId] = useState<string | null>(
    activeSequence(initial).tracks.find((track) => track.kind === 'video')?.clips[0]?.id ?? null,
  );
  const [leftTab, setLeftTab] = useState<LeftTab>('takes');
  const [rightTab, setRightTab] = useState<RightTab>('inspector');
  const [zoom, setZoom] = useState(1);
  const [compare, setCompare] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [menu, setMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const selected = selectedClipOf(project, selectedId);
  const duration = sequenceDurationMs(activeSequence(project));

  const commit = useCallback((next: VideoProject | null, push = true) => {
    if (!next) return;
    setProject((current) => {
      if (push) setHistory((stack) => pushHistory(stack, current));
      return next;
    });
    setSaveState('dirty');
  }, []);

  useEffect(() => {
    resetPlayback(duration);
  }, [project.id]);

  useEffect(() => {
    setPlayback({ durationMs: duration });
  }, [duration]);

  useEffect(() => {
    let frameId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const playback = getPlayback();
      if (playback.playing) {
        const dt = now - last;
        const next = playback.timeMs + dt;
        const max = Math.max(0, getPlayback().durationMs);
        if (next >= max) setPlayback({ timeMs: max, playing: false });
        else setPlayback({ timeMs: next });
      }
      last = now;
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    if (!reelId || saveState !== 'dirty') return;
    const timer = window.setTimeout(async () => {
      setSaveState('saving');
      const response = await fetch(`/api/editor/${reelId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: projectRef.current }),
      });
      setSaveState(response.ok ? 'saved' : 'dirty');
      if (!response.ok) toast.error('Não foi possível guardar o projeto.');
    }, 900);
    return () => window.clearTimeout(timer);
  }, [project, reelId, saveState]);

  useEffect(() => {
    if (reelId) return;
    window.localStorage.setItem('cenapronta.editor.local', JSON.stringify(project));
  }, [project, reelId]);

  const splitSelected = useCallback(() => {
    const time = getPlayback().timeMs;
    const clipId =
      selectedId ??
      activeSequence(projectRef.current)
        .tracks.find((track) => track.kind === 'video')
        ?.clips.find((clip) => time >= clip.timelineStartMs && time < clip.timelineEndMs)?.id;
    if (!clipId) return;
    commit(splitClipAtPlayhead(projectRef.current, clipId, time));
  }, [commit, selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = matchEditorShortcut(event);
      if (!action) return;
      event.preventDefault();
      const current = projectRef.current;
      const time = getPlayback().timeMs;
      const fps = current.settings.fps;
      const frame = 1000 / fps;
      if (action === 'play-pause') setPlayback({ playing: !getPlayback().playing });
      if (action === 'pause') setPlayback({ playing: false });
      if (action === 'back') setPlayback({ timeMs: Math.max(0, time - 1000), playing: false });
      if (action === 'forward') setPlayback({ timeMs: time + 1000, playing: false });
      if (action === 'frame-back')
        setPlayback({ timeMs: Math.max(0, time - frame), playing: false });
      if (action === 'frame-forward') setPlayback({ timeMs: time + frame, playing: false });
      if (action === 'start') setPlayback({ timeMs: 0, playing: false });
      if (action === 'end')
        setPlayback({ timeMs: sequenceDurationMs(activeSequence(current)), playing: false });
      if (action === 'undo') {
        const undone = undoProject(current, history);
        if (undone) {
          setProject(undone.project);
          setHistory(undone.history);
        }
      }
      if (action === 'redo') {
        const redone = redoProject(current, history);
        if (redone) {
          setProject(redone.project);
          setHistory(redone.history);
        }
      }
      if (action === 'split') splitSelected();
      if (action === 'delete' && selectedId) commit(deleteClip(current, selectedId, false));
      if (action === 'ripple-delete' && selectedId) commit(deleteClip(current, selectedId, true));
      if (action === 'duplicate' && selectedId) commit(duplicateClip(current, selectedId));
      if (action === 'lock' && selectedId) {
        const clip = selectedClipOf(current, selectedId);
        if (clip) commit(setClipLocked(current, selectedId, !clip.lockedByUser));
      }
      if (action === 'snap') {
        commit({
          ...current,
          settings: { ...current.settings, snap: !current.settings.snap },
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, history, selectedId, splitSelected]);

  async function importFiles(files: FileList | File[], timelineStart?: number) {
    const nextFiles = [...files].filter(
      (file) => file.type.startsWith('video') || file.type.startsWith('audio'),
    );
    if (!nextFiles.length) return;
    let next = project;
    for (const file of nextFiles) {
      const durationSec = await readDuration(file);
      const url = URL.createObjectURL(file);
      const media: MediaAsset = {
        id: createEntityId('media'),
        kind: file.type.startsWith('audio') ? 'audio' : 'video',
        name: file.name,
        durationMs: Math.round(durationSec * 1000),
        width: 1920,
        height: 1080,
        fps: 30,
        hasAudio: true,
        previewUrl: url,
        takeStatus: 'available',
      };
      next = addMediaAndClip(next, media, { timelineStartMs: timelineStart });
    }
    commit(next);
  }

  function addMedia(media: MediaAsset, whole: boolean) {
    const out = whole ? media.durationMs || 4000 : Math.min(media.durationMs || 4000, 4000);
    commit(
      addMediaAndClip(project, media, {
        sourceInMs: 0,
        sourceOutMs: Math.max(200, out),
      }),
    );
  }

  async function exportProject() {
    if (!reelId) {
      toast.message('Guarde este projeto num Reel para exportar com FFmpeg.');
      return;
    }
    const response = await fetch(`/api/editor/${reelId}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast.error(body.error ?? 'Export failed');
      return;
    }
    toast.success('Render na fila. O MP4 sai do mesmo projeto da timeline.');
  }

  const leftTabs: Array<{ id: LeftTab; label: string }> = [
    { id: 'takes', label: 'Takes' },
    { id: 'media', label: 'Mídia' },
    { id: 'unused', label: 'Não usados' },
    { id: 'effects', label: 'Efeitos' },
    { id: 'transitions', label: 'Transições' },
    { id: 'audio', label: 'Áudio' },
    { id: 'captions', label: 'Legendas' },
    { id: 'ai', label: 'IA' },
  ];

  const contextItems = useMemo(
    () => [
      { id: 'split', label: 'Split' },
      { id: 'duplicate', label: 'Duplicate' },
      { id: 'delete', label: 'Delete' },
      { id: 'ripple', label: 'Ripple Delete' },
      { id: 'detach', label: 'Detach Audio' },
      { id: 'lock', label: 'Lock' },
    ],
    [],
  );

  return (
    <div
      className="nle flex h-dvh flex-col overflow-hidden"
      onContextMenu={(event) => {
        const clipEl = (event.target as HTMLElement).closest('[style]');
        if (selectedId && clipEl) {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, clipId: selectedId });
        }
      }}
      onClick={() => setMenu(null)}
    >
      <header className="nle-topbar">
        <Link href={reelId ? `/reels/${reelId}` : '/reels'} className="nle-icon" title="Voltar">
          <ArrowLeft className="size-4" />
        </Link>
        <Film className="size-4 text-[#d4a24c]" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight">
            {title ?? project.name}
          </p>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[#8a94a7]">
            {saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Alterado' : 'Saved'}
            {project.program ? ` · ${project.program}` : ''} · rev {project.projectVersion} ·
            Preview ≠ Render
          </p>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <span className="nle-kicker mr-2 hidden lg:inline">Edição</span>
          <button
            type="button"
            className="nle-tool"
            title="Desfazer"
            onClick={() => {
              const undone = undoProject(project, history);
              if (undone) {
                setProject(undone.project);
                setHistory(undone.history);
              }
            }}
          >
            <Undo2 className="size-3.5" />
          </button>
          <button
            type="button"
            className="nle-tool"
            title="Refazer"
            onClick={() => {
              const redone = redoProject(project, history);
              if (redone) {
                setProject(redone.project);
                setHistory(redone.history);
              }
            }}
          >
            <Redo2 className="size-3.5" />
          </button>
          <button
            type="button"
            className="nle-tool"
            title="Tesoura / Split"
            onClick={splitSelected}
          >
            <Scissors className="size-3.5" />
          </button>
          <span className="mx-1 h-5 w-px bg-[#262d3a]" />
          <button
            type="button"
            className="nle-tool"
            onClick={() => setZoom((value) => Math.max(0.25, value / 1.2))}
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            className="nle-tool"
            onClick={() => setZoom((value) => Math.min(6, value * 1.2))}
          >
            <Plus className="size-3.5" />
          </button>
          <button
            type="button"
            className="nle-tool px-2 text-[10px] uppercase tracking-wider"
            aria-pressed={compare}
            onClick={() => setCompare((value) => !value)}
          >
            A/B
          </button>
          <button
            type="button"
            className="nle-tool px-2 text-[11px]"
            onClick={() => fileRef.current?.click()}
          >
            Importar
          </button>
          <button
            type="button"
            className="ml-2 h-7 rounded-sm bg-[#d4a24c] px-3 text-[12px] font-semibold text-black hover:bg-[#e0b25c]"
            onClick={() => void exportProject()}
          >
            Exportar
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 border-r border-[#262d3a] bg-[#10131a]">
          <nav className="flex w-14 shrink-0 flex-col gap-0.5 border-r border-[#262d3a] py-2">
            {leftTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setLeftTab(tab.id)}
                className={cn(
                  'mx-1 rounded-sm px-1 py-2 text-[9px] font-bold uppercase tracking-wider',
                  leftTab === tab.id
                    ? 'bg-[#d4a24c] text-black'
                    : 'text-[#8a94a7] hover:bg-[#1d2430] hover:text-white',
                )}
              >
                {tab.id === 'ai' ? <Sparkles className="mx-auto mb-0.5 size-3.5" /> : null}
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {leftTab === 'effects' ? (
              <EffectsBin
                onMotion={(preset) =>
                  selectedId && commit(patchClip(project, selectedId, { motion: preset }))
                }
              />
            ) : leftTab === 'transitions' ? (
              <TransitionsBin
                onPick={(type) => selectedId && commit(setTransitionIn(project, selectedId, type))}
              />
            ) : leftTab === 'ai' ? (
              <AiPanel
                project={project}
                onMode={(mode: AutomationMode) => commit(withAiMode(project, mode))}
                onCommand={(command) =>
                  toast.message(`${command} entra na timeline, não gera MP4 direto.`)
                }
              />
            ) : leftTab === 'audio' ? (
              <div className="space-y-2 p-3 text-[12px]">
                <button
                  type="button"
                  className="h-7 w-full rounded border border-[#232a36]"
                  onClick={() =>
                    commit(
                      muteTrack(
                        project,
                        'track_a1',
                        !activeSequence(project).tracks.find((track) => track.id === 'track_a1')
                          ?.muted,
                      ),
                    )
                  }
                >
                  {activeSequence(project).tracks.find((track) => track.id === 'track_a1')?.muted
                    ? 'Ligar áudio original'
                    : 'Remover áudio original'}
                </button>
                <p className="text-[11px] text-[#8d97a8]">
                  Detach Audio no inspector transforma o som em clip na A1.
                </p>
              </div>
            ) : leftTab === 'captions' ? (
              <div className="p-3 text-[12px] text-[#8d97a8]">
                {project.captions.length
                  ? project.captions.map((cue) => (
                      <p key={cue.id} className="mb-2 text-[#e6ebf3]">
                        {cue.text}
                      </p>
                    ))
                  : 'Sem legendas neste projeto. A IA pode gerar; o timing fica editável.'}
              </div>
            ) : (
              <MediaBin
                project={project}
                tab={leftTab === 'unused' ? 'unused' : leftTab === 'takes' ? 'takes' : 'media'}
                onAdd={addMedia}
                onAddRange={(media, inMs, outMs) =>
                  commit(addMediaAndClip(project, media, { sourceInMs: inMs, sourceOutMs: outMs }))
                }
              />
            )}
          </div>
        </aside>

        <section
          className="flex min-w-0 flex-1 flex-col bg-black"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            if (event.dataTransfer.files.length) {
              event.preventDefault();
              void importFiles(event.dataTransfer.files);
            }
          }}
        >
          <PreviewMonitor project={project} compare={compare} />
          <PlayerBar project={project} />
        </section>

        <aside className="flex w-[320px] shrink-0 flex-col border-l border-[#262d3a] bg-[#10131a]">
          <div className="flex border-b border-[#262d3a]">
            {(['inspector', 'ai'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightTab(tab)}
                className={cn(
                  'h-9 flex-1 text-[10px] font-bold uppercase tracking-[0.14em]',
                  rightTab === tab
                    ? 'border-b-2 border-[#d4a24c] text-[#d4a24c]'
                    : 'text-[#8a94a7] hover:text-white',
                )}
              >
                {tab === 'inspector' ? 'Inspector' : 'AI'}
              </button>
            ))}
          </div>
          {rightTab === 'ai' ? (
            <AiPanel
              project={project}
              onMode={(mode) => commit(withAiMode(project, mode))}
              onCommand={(command) => toast.message(`${command} atualiza o projeto, não o MP4.`)}
            />
          ) : (
            <ClipInspector
              project={project}
              clip={selected}
              onPatch={(patch) =>
                selectedId && commit(patchClip(project, selectedId, patch), false)
              }
              onLock={(locked) => selectedId && commit(setClipLocked(project, selectedId, locked))}
              onDetach={() => selectedId && commit(detachAudio(project, selectedId))}
            />
          )}
        </aside>
      </div>

      <div className="h-[280px] shrink-0">
        <EditorTimeline
          project={project}
          selectedId={selectedId}
          zoom={zoom}
          snap={project.settings.snap}
          onSelect={setSelectedId}
          onTrim={(clipId, edge, time) => {
            const snapped = project.settings.snap ? snapTimeMs(project, time) : time;
            commit(trimClip(project, clipId, edge, snapped), false);
          }}
          onMove={(clipId, time) => {
            const snapped = project.settings.snap ? snapTimeMs(project, time) : time;
            commit(moveClip(project, clipId, snapped), false);
          }}
          onSplitAt={splitSelected}
          onDropMedia={(mediaId, time, trackId) => {
            const media = project.media.find((item) => item.id === mediaId);
            if (!media) return;
            const clip = makeVideoClip({
              mediaId,
              name: media.name,
              sourceOutMs: media.durationMs || 2000,
              timelineStartMs: time,
            });
            if (media.kind === 'audio') clip.kind = 'audio';
            commit(insertClipAt(project, trackId, clip, time));
          }}
          onDropTransition={(clipId, type) => {
            if (transitionTypes.includes(type as TransitionType)) {
              commit(setTransitionIn(project, clipId, type as TransitionType));
            }
          }}
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="video/*,audio/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void importFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {menu ? (
        <ul
          className="fixed z-50 min-w-40 rounded border border-[#232a36] bg-[#181c24] py-1 text-[12px] shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          {contextItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left hover:bg-[#232a36]"
                onClick={() => {
                  if (item.id === 'split') splitSelected();
                  if (item.id === 'duplicate') commit(duplicateClip(project, menu.clipId));
                  if (item.id === 'delete') commit(deleteClip(project, menu.clipId, false));
                  if (item.id === 'ripple') commit(deleteClip(project, menu.clipId, true));
                  if (item.id === 'detach') commit(detachAudio(project, menu.clipId));
                  if (item.id === 'lock') {
                    const clip = selectedClipOf(project, menu.clipId);
                    if (clip) commit(setClipLocked(project, menu.clipId, !clip.lockedByUser));
                  }
                  setMenu(null);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export { createEmptyProject };
