'use client';

import {
  formatProjectTimecode,
  mediaById,
  type ProjectClip,
  type VideoProject,
  motionPresets,
  transitionLabels,
  transitionTypes,
} from '@reelops/shared';

export default function ClipInspector({
  project,
  clip,
  onPatch,
  onLock,
  onDetach,
  onSourceWindow,
}: {
  project: VideoProject;
  clip: ProjectClip | null;
  onPatch: (patch: Partial<ProjectClip>) => void;
  onLock: (locked: boolean) => void;
  onDetach: () => void;
  onSourceWindow?: (sourceInMs: number, sourceOutMs: number) => void;
}) {
  if (!clip) {
    return (
      <div className="p-4 text-[12px] text-[#8d97a8]">
        Selecione um clip na timeline para ver source in/out, crop, volume e o motivo da IA.
      </div>
    );
  }
  const media = mediaById(project, clip.mediaId);
  const duration = clip.timelineEndMs - clip.timelineStartMs;
  return (
    <div className="nle-scroll h-full space-y-3 overflow-y-auto p-3 text-[12px]">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-[#8d97a8]">Source</p>
        <p className="truncate font-medium">{media?.name ?? clip.name}</p>
        <p className="text-[#8d97a8]">{media?.cameraLabel ?? clip.kind}</p>
      </div>
      <Field
        label="Source In"
        value={formatProjectTimecode(clip.sourceInMs, project.settings.fps)}
      />
      <Field
        label="Source Out"
        value={formatProjectTimecode(clip.sourceOutMs, project.settings.fps)}
      />
      {onSourceWindow ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-[#8d97a8]">In (s)</span>
            <input
              type="number"
              min={0}
              step={0.04}
              defaultValue={(clip.sourceInMs / 1000).toFixed(2)}
              key={`${clip.id}-in-${clip.sourceInMs}`}
              onBlur={(event) =>
                onSourceWindow(Math.round(Number(event.target.value) * 1000), clip.sourceOutMs)
              }
              className="mt-1 h-7 w-full rounded border border-[#232a36] bg-[#0b0d11] px-1 font-mono text-[11px]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-[#8d97a8]">Out (s)</span>
            <input
              type="number"
              min={0.2}
              step={0.04}
              defaultValue={(clip.sourceOutMs / 1000).toFixed(2)}
              key={`${clip.id}-out-${clip.sourceOutMs}`}
              onBlur={(event) =>
                onSourceWindow(clip.sourceInMs, Math.round(Number(event.target.value) * 1000))
              }
              className="mt-1 h-7 w-full rounded border border-[#232a36] bg-[#0b0d11] px-1 font-mono text-[11px]"
            />
          </label>
        </div>
      ) : null}
      <Field label="Duração" value={`${(duration / 1000).toFixed(2)}s`} />
      {clip.ai?.score != null ? <Field label="AI Score" value={String(clip.ai.score)} /> : null}
      {clip.ai?.reason ? (
        <p className="rounded border border-[#232a36] bg-[#181c24] p-2 text-[11px] leading-relaxed text-[#c5cedb]">
          {clip.ai.reason}
        </p>
      ) : null}
      {clip.transform.crop ? (
        <Field
          label="Crop 9:16"
          value={`${Math.round(clip.transform.crop.width * 100)}% · x ${Math.round(clip.transform.crop.x * 100)}%`}
        />
      ) : null}
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-[#8d97a8]">Scale</span>
        <input
          type="range"
          min={1}
          max={1.3}
          step={0.01}
          value={clip.transform.scale}
          onChange={(event) =>
            onPatch({ transform: { ...clip.transform, scale: Number(event.target.value) } })
          }
          className="mt-1 w-full accent-[#d4a24c]"
        />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-[#8d97a8]">Opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={clip.transform.opacity}
          onChange={(event) =>
            onPatch({ transform: { ...clip.transform, opacity: Number(event.target.value) } })
          }
          className="mt-1 w-full accent-[#d4a24c]"
        />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-[#8d97a8]">Volume</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={clip.volume}
          onChange={(event) => onPatch({ volume: Number(event.target.value) })}
          className="mt-1 w-full accent-[#d4a24c]"
        />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-[#8d97a8]">Speed</span>
        <select
          value={clip.speed}
          onChange={(event) => onPatch({ speed: Number(event.target.value) })}
          className="mt-1 h-7 w-full rounded border border-[#232a36] bg-[#0b0d11] px-1"
        >
          {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
            <option key={speed} value={speed}>
              {speed}x
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-[#8d97a8]">Motion</span>
        <select
          value={clip.motion}
          onChange={(event) => onPatch({ motion: event.target.value as ProjectClip['motion'] })}
          className="mt-1 h-7 w-full rounded border border-[#232a36] bg-[#0b0d11] px-1"
        >
          {motionPresets.map((preset) => (
            <option key={preset} value={preset}>
              {preset.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-[#8d97a8]">
          Transição à entrada
        </span>
        <select
          value={clip.transitionIn?.type ?? 'cut'}
          onChange={(event) => {
            const type = event.target.value as (typeof transitionTypes)[number];
            onPatch({
              transitionIn:
                type === 'cut'
                  ? undefined
                  : { type, durationMs: 400, easing: 'ease', intensity: 1 },
            });
          }}
          className="mt-1 h-7 w-full rounded border border-[#232a36] bg-[#0b0d11] px-1"
        >
          {transitionTypes.map((type) => (
            <option key={type} value={type}>
              {transitionLabels[type]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1 pt-1">
        <button
          type="button"
          className="h-7 rounded border border-[#232a36] px-2 text-[11px] hover:bg-[#181c24]"
          onClick={() => onPatch({ muted: !clip.muted })}
        >
          {clip.muted ? 'Unmute' : 'Mute áudio'}
        </button>
        {clip.kind === 'video' ? (
          <button
            type="button"
            className="h-7 rounded border border-[#232a36] px-2 text-[11px] hover:bg-[#181c24]"
            onClick={onDetach}
          >
            Detach audio
          </button>
        ) : null}
        <button
          type="button"
          className="h-7 rounded border border-[#232a36] px-2 text-[11px] hover:bg-[#181c24]"
          onClick={() => onLock(!clip.lockedByUser)}
        >
          {clip.lockedByUser ? 'Unlock' : 'Lock'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-[#8d97a8]">{label}</span>
      <span className="font-mono text-[11px]">{value}</span>
    </div>
  );
}
