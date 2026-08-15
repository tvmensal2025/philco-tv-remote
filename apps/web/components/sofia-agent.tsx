'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FolderOpen, LoaderCircle, ScanSearch, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Discovery = {
  id?: string;
  ip: string;
  kind?: string;
  brand?: string;
  name?: string;
  ports?: number[];
};

type Session = {
  status: string;
  discoveries: Discovery[];
  selection: Record<string, unknown>;
  lastError?: string | null;
  agentLive: boolean;
  updatedAt?: string;
};

const DEFAULT_FOLDER = 'C:\\CenaPronta\\cameras';

function statusCopy(status: string, agentLive: boolean) {
  if (!agentLive && (status === 'waiting_agent' || status === 'scanning')) {
    return 'Ligue o Uploader no computador da casa. A Sofia só enxerga a rede de lá.';
  }
  if (status === 'waiting_agent' || status === 'scanning')
    return 'Procurando o gravador nesta Wi-Fi…';
  if (status === 'found') return 'Achei isto na rede. Confira se é o gravador da casa.';
  if (status === 'configuring') return 'Ligando os canais no gravador…';
  if (status === 'ready') return 'Pronto. As câmeras já entram sozinhas.';
  if (status === 'need_folder')
    return 'Nenhum gravador nesta Wi-Fi. Use a pasta do NVR ou o celular.';
  if (status === 'failed') return 'Não deu para ligar o gravador. Confira a senha ou use a pasta.';
  return 'A Sofia acha o gravador na Wi-Fi da casa. Câmera analógica não tem IP — o que aparece é o DVR.';
}

export default function SofiaAgent({
  restaurantId,
  canConfigure,
}: {
  restaurantId: string;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [folderPath, setFolderPath] = useState(DEFAULT_FOLDER);

  async function load() {
    if (!restaurantId) return;
    const response = await fetch(`/api/sofia?restaurantId=${restaurantId}`);
    const data = await response.json();
    if (!response.ok) return;
    const next = data.session as Session | null;
    setSession(next);
    const first = (next?.discoveries ?? [])[0];
    if (first && !deviceId) setDeviceId(first.id || first.ip);
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const response = await fetch('/api/sofia', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restaurantId, ...body }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      toast.error(data.error ?? 'A Sofia não conseguiu.');
      return;
    }
    await load();
    if (body.action === 'start') toast.success('Sofia saiu à procura do gravador');
    if (body.action === 'folder') toast.success('Uploader vai olhar a pasta do gravador');
    if (body.action === 'confirm') toast.success('Sofia está ligando os canais');
    router.refresh();
  }

  const discoveries = session?.discoveries ?? [];
  const status = session?.status ?? 'idle';
  const active = ['waiting_agent', 'scanning', 'found', 'configuring'].includes(status);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15">
              {status === 'scanning' || status === 'waiting_agent' ? (
                <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <Sparkles className="h-5 w-5 text-primary" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold">Sofia</p>
              <p className="text-sm text-muted-foreground">
                {statusCopy(status, Boolean(session?.agentLive))}
              </p>
              {session?.lastError ? (
                <p className="mt-1 text-sm text-destructive">{session.lastError}</p>
              ) : null}
            </div>
          </div>
          {canConfigure ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || !restaurantId}
                onClick={() => void act({ action: 'start' })}
              >
                <ScanSearch className="mr-2 h-4 w-4" />
                {active ? 'Procurar de novo' : 'Achar as câmeras'}
              </Button>
              {active ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act({ action: 'cancel' })}
                >
                  Cancelar
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {discoveries.length ? (
          <div className="space-y-2">
            {discoveries.map((device) => {
              const id = device.id || device.ip;
              const selected = deviceId === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={!canConfigure}
                  onClick={() => setDeviceId(id)}
                  className={cn(
                    'w-full rounded-xl border px-3 py-3 text-left text-sm transition',
                    selected
                      ? 'border-primary bg-background'
                      : 'bg-background/60 hover:bg-background',
                  )}
                >
                  <span className="font-medium">{device.name || device.ip}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {device.kind === 'dvr'
                      ? 'Gravador — as 4 câmeras entram pelos canais dele'
                      : device.kind === 'app_locked'
                        ? 'Só fala com o app. Melhor enviar o vídeo pelo celular.'
                        : 'Câmera IP nesta rede'}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {status === 'found' && canConfigure ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              placeholder="Usuário do gravador"
              value={username}
              autoComplete="off"
              onChange={(event) => setUsername(event.target.value)}
            />
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              placeholder="Senha do gravador"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button
              type="button"
              className="sm:col-span-2"
              disabled={busy || !deviceId}
              onClick={() =>
                void act({
                  action: 'confirm',
                  deviceId,
                  username,
                  password,
                  channels: [1, 2, 3, 4],
                })
              }
            >
              Sim, são essas câmeras
            </Button>
          </div>
        ) : null}

        {canConfigure &&
        (status === 'need_folder' ||
          status === 'failed' ||
          status === 'found' ||
          status === 'idle' ||
          status === 'ready') ? (
          <div className="space-y-2 rounded-xl border bg-background/70 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Pasta do gravador — o caminho que muita casa já tem
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 font-mono text-xs"
                value={folderPath}
                onChange={(event) => setFolderPath(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void act({ action: 'folder', folderPath })}
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                Usar esta pasta
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Padrão: {DEFAULT_FOLDER}\C1 a C4. O Uploader lê e não apaga o original do NVR.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
