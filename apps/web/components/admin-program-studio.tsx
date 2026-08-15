'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  cloneValidatedSpec,
  diffProgramSpecs,
  editProgramLabels,
  renderEffectCatalog,
  specsEqual,
  type CatalogEffect,
  type EditProgram,
  type ProgramPresetSpec,
} from '@reelops/shared';
import AdminProgramNle, { type SpecHistoryMode } from '@/components/admin-program-nle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type ProgramPayload = {
  program: EditProgram;
  label: string;
  validated: ProgramPresetSpec;
  published: { version: number; spec: ProgramPresetSpec } | null;
  draft: { version: number; spec: ProgramPresetSpec } | null;
};

const programsList: EditProgram[] = ['casa', 'oficio', 'assinatura', 'pulso'];

function studioSourceStatus(spec: ProgramPresetSpec, payload: ProgramPayload) {
  if (payload.draft && specsEqual(spec, payload.draft.spec)) {
    return {
      kind: 'draft' as const,
      label: `Rascunho v${payload.draft.version}`,
      variant: 'warning' as const,
    };
  }
  if (payload.published && specsEqual(spec, payload.published.spec)) {
    return {
      kind: 'published' as const,
      label: `Publicado v${payload.published.version}`,
      variant: 'success' as const,
    };
  }
  if (specsEqual(spec, payload.validated)) {
    return { kind: 'validated' as const, label: 'Validado', variant: 'info' as const };
  }
  return { kind: 'dirty' as const, label: 'Alterações por guardar', variant: 'outline' as const };
}

export default function AdminProgramStudio({ mode = 'live' }: { mode?: 'live' | 'fixture' }) {
  const [catalog, setCatalog] = useState<CatalogEffect[]>(renderEffectCatalog);
  const [programs, setPrograms] = useState<Record<EditProgram, ProgramPresetSpec> | null>(null);
  const [payloads, setPayloads] = useState<Record<EditProgram, ProgramPayload> | null>(null);
  const [active, setActive] = useState<EditProgram>('pulso');
  const [selected, setSelected] = useState(0);
  const [past, setPast] = useState<ProgramPresetSpec[]>([]);
  const [future, setFuture] = useState<ProgramPresetSpec[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const coalesceRef = useRef(false);

  async function reload() {
    setLoadState('loading');
    setError('');
    if (mode === 'fixture') {
      const nextPayloads = {} as Record<EditProgram, ProgramPayload>;
      const nextPrograms = {} as Record<EditProgram, ProgramPresetSpec>;
      for (const program of programsList) {
        const validated = cloneValidatedSpec(program);
        nextPayloads[program] = {
          program,
          label: editProgramLabels[program],
          validated,
          published: null,
          draft: null,
        };
        nextPrograms[program] = structuredClone(validated);
      }
      setCatalog(renderEffectCatalog);
      setPrograms(nextPrograms);
      setPayloads(nextPayloads);
      setPast([]);
      setFuture([]);
      coalesceRef.current = false;
      setLoadState('ready');
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch('/api/admin/studio', { signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Falha ao carregar o estúdio');
      const nextPrograms = {} as Record<EditProgram, ProgramPresetSpec>;
      const nextPayloads = {} as Record<EditProgram, ProgramPayload>;
      for (const item of body.programs as ProgramPayload[]) {
        nextPayloads[item.program] = item;
        nextPrograms[item.program] = structuredClone(
          item.draft?.spec ?? item.published?.spec ?? item.validated,
        );
      }
      setCatalog(
        Array.isArray(body.catalog) && body.catalog.length ? body.catalog : renderEffectCatalog,
      );
      setPrograms(nextPrograms);
      setPayloads(nextPayloads);
      setPast([]);
      setFuture([]);
      coalesceRef.current = false;
      setLoadState('ready');
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'O estúdio demorou demais a responder.'
            : err.message
          : 'Erro',
      );
      setLoadState('error');
    } finally {
      window.clearTimeout(timeout);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per mode
  }, [mode]);

  const spec = programs?.[active];
  const payload = payloads?.[active];
  const status = spec && payload ? studioSourceStatus(spec, payload) : null;
  const baseline = payload?.published?.spec ?? payload?.validated;
  const publishDiff = spec && baseline ? diffProgramSpecs(baseline, spec) : [];

  function commit(next: ProgramPresetSpec, options?: { history?: SpecHistoryMode }) {
    if (!spec) return;
    const historyMode = options?.history ?? 'push';
    if (historyMode === 'push') {
      setPast((history) => [...history.slice(-40), spec]);
      setFuture([]);
      coalesceRef.current = false;
    } else if (!coalesceRef.current) {
      setPast((history) => [...history.slice(-40), spec]);
      setFuture([]);
      coalesceRef.current = true;
    }
    setPrograms((current) => (current ? { ...current, [active]: next } : current));
    setSelected((index) => Math.min(index, next.beats.length - 1));
  }

  function undo() {
    const previous = past.at(-1);
    if (!previous || !spec) return;
    setPast((history) => history.slice(0, -1));
    setFuture((history) => [spec, ...history]);
    setPrograms((current) => (current ? { ...current, [active]: previous } : current));
    setSelected((index) => Math.min(index, previous.beats.length - 1));
    coalesceRef.current = false;
  }

  function redo() {
    const next = future[0];
    if (!next || !spec) return;
    setFuture((history) => history.slice(1));
    setPast((history) => [...history, spec]);
    setPrograms((current) => (current ? { ...current, [active]: next } : current));
    setSelected((index) => Math.min(index, next.beats.length - 1));
    coalesceRef.current = false;
  }

  async function save(kind: 'draft' | 'publish') {
    if (!spec) return;
    setSaving(true);
    try {
      const response = await fetch('/api/admin/studio', {
        method: kind === 'draft' ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ program: active, spec }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível gravar');
      toast.success(
        kind === 'draft'
          ? 'Rascunho guardado só neste estúdio. Os restaurantes ainda usam o padrão publicado.'
          : `Padrão publicado. Os próximos Reels de ${editProgramLabels[active]} em todos os restaurantes usam isto.`,
      );
      setPublishOpen(false);
      await reload();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro');
    } finally {
      setSaving(false);
    }
  }

  if (loadState === 'error') {
    return (
      <div className="nle flex h-full min-h-0 flex-col justify-center gap-3 p-8">
        <h1 className="font-heading text-2xl font-semibold">Estúdio dos 4 programas</h1>
        <p className="text-sm text-destructive">{error || 'Não foi possível abrir o estúdio.'}</p>
        <Button type="button" onClick={() => void reload()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  if (loadState === 'loading' || !spec || !payload || !status) {
    return (
      <div className="nle flex h-full min-h-0 flex-col justify-center gap-2 p-8">
        <h1 className="font-heading text-2xl font-semibold">Estúdio dos 4 programas</h1>
        <p className="text-sm text-[#8a94a7]">Abrindo o padrão validado…</p>
        <p className="text-xs text-[#8a94a7]">
          Se isto não sair em alguns segundos, use tentar de novo na mensagem de erro.
        </p>
      </div>
    );
  }

  return (
    <div className="nle flex h-full min-h-0 flex-col overflow-hidden">
      <Tabs
        className="flex min-h-0 flex-1 flex-col gap-0"
        value={active}
        onValueChange={(value) => {
          setActive(value as EditProgram);
          setSelected(0);
          setPast([]);
          setFuture([]);
          coalesceRef.current = false;
        }}
      >
        <header className="nle-topbar">
          <div className="min-w-0">
            <h1 className="truncate text-[13px] font-semibold leading-tight">
              Estúdio dos 4 programas
            </h1>
            <p className="truncate text-[10px] text-[#8a94a7]">
              Playbook da fábrica · o MP4 sai deste padrão
            </p>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
          <TabsList variant="line" className="h-8 bg-transparent p-0">
            {programsList.map((program) => (
              <TabsTrigger
                key={program}
                value={program}
                className="h-8 rounded-none px-3 text-[12px] data-[state=active]:text-[#d4a24c]"
              >
                {editProgramLabels[program]}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-[#262d3a] bg-transparent text-[12px]"
              disabled={saving}
              onClick={() => commit(cloneValidatedSpec(active))}
            >
              Restaurar validado
            </Button>
            {mode === 'live' ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-[12px]"
                  disabled={saving}
                  onClick={() => void save('draft')}
                >
                  Guardar rascunho
                </Button>
                <Button
                  size="sm"
                  className="h-7 bg-[#d4a24c] text-[12px] text-black hover:bg-[#e0b25c]"
                  disabled={saving || status.kind === 'published'}
                  onClick={() => setPublishOpen(true)}
                >
                  Publicar para restaurantes
                </Button>
              </>
            ) : null}
          </div>
        </header>
        <TabsContent
          value={active}
          className="mt-0 flex h-full min-h-0 flex-1 flex-col overflow-hidden p-0"
        >
          <AdminProgramNle
            spec={spec}
            catalog={catalog}
            selected={selected}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            onSelect={setSelected}
            onChange={commit}
            onUndo={undo}
            onRedo={redo}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publicar {editProgramLabels[active]} para os restaurantes?</DialogTitle>
            <DialogDescription>
              Todos os clientes passam a montar os próximos Reels deste programa com este padrão
              (takes, transições, motion, overlays). Diff contra{' '}
              {payload.published
                ? `publicado v${payload.published.version}`
                : 'o validado de fábrica'}
              . Entra nos jobs seguintes (o worker refresca em poucos segundos).
            </DialogDescription>
          </DialogHeader>
          {publishDiff.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada muda em relação à base. Publicar só regrava a mesma versão viva.
            </p>
          ) : (
            <ul className="max-h-56 list-disc space-y-1 overflow-auto pl-5 text-sm">
              {publishDiff.map((line) => (
                <li key={line.label}>{line.label}</li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPublishOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={saving} onClick={() => void save('publish')}>
              Publicar para restaurantes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
