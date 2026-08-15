'use client';

import {
  automationModeLabels,
  automationModes,
  formatProjectTimecode,
  type AutomationMode,
  type VideoProject,
} from '@reelops/shared';

const commands = [
  'Editar automaticamente',
  'Melhorar cortes',
  'Melhorar ritmo',
  'Encontrar melhores momentos',
  'Remover momentos ruins',
  'Criar hook',
  'Adicionar B-roll',
  'Adicionar música',
  'Criar zoom automático',
  'Criar legendas',
  'Remover silêncios',
  'Criar Reel',
  'Criar Story',
];

export default function AiPanel({
  project,
  onMode,
  onCommand,
}: {
  project: VideoProject;
  onMode: (mode: AutomationMode) => void;
  onCommand: (command: string) => void;
}) {
  const decisions = project.ai?.decisions ?? [];
  const quality = project.ai?.quality;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[#232a36] p-3">
        <p className="text-[10px] uppercase tracking-wider text-[#8d97a8]">Modo</p>
        <select
          value={project.ai?.mode ?? 'balanced'}
          onChange={(event) => onMode(event.target.value as AutomationMode)}
          className="mt-1 h-7 w-full rounded border border-[#232a36] bg-[#0b0d11] px-1 text-[12px]"
        >
          {automationModes.map((mode) => (
            <option key={mode} value={mode}>
              {automationModeLabels[mode]}
            </option>
          ))}
        </select>
        <div className="mt-2 grid grid-cols-2 gap-1">
          {commands.map((command) => (
            <button
              key={command}
              type="button"
              className="h-7 rounded border border-[#232a36] px-2 text-left text-[10px] hover:border-[#d4a24c]/40"
              onClick={() => onCommand(command)}
            >
              {command}
            </button>
          ))}
        </div>
      </div>
      {quality ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-[#232a36] px-3 py-2 text-[11px]">
          {Object.entries(quality).map(([key, value]) => (
            <div key={key} className="flex justify-between">
              <span className="capitalize text-[#8d97a8]">{key}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="nle-scroll min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-[#8d97a8]">AI Decisions</p>
        {decisions.length === 0 ? (
          <p className="text-[12px] text-[#8d97a8]">
            A automação ainda não registrou decisões neste projeto.
          </p>
        ) : (
          <ol className="space-y-2">
            {decisions.map((row) => (
              <li key={row.id} className="border-l-2 border-[#d4a24c]/70 pl-2">
                <p className="font-mono text-[10px] text-[#8d97a8]">
                  {formatProjectTimecode(row.atMs, project.settings.fps)} · {row.kind}
                </p>
                <p className="text-[12px] leading-snug">{row.reason}</p>
                {row.detail ? <p className="text-[11px] text-[#8d97a8]">{row.detail}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
