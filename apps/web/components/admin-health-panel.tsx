'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Health = {
  status: string;
  checks: Record<string, { ok: boolean; detail?: string }>;
};

export default function AdminHealthPanel() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/health')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok && !body.checks) throw new Error(body.error ?? 'Falha no pulso');
        setData(body);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro'));
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data)
    return <p className="text-sm text-muted-foreground">Lendo Redis, MinIO, worker e FFmpeg…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Pulso da VPS</h1>
        <p className="text-sm text-muted-foreground">
          Se isto está vermelho, todas as casas sofrem. Não é o dashboard do restaurante.
        </p>
      </div>
      <Badge variant={data.status === 'healthy' ? 'success' : 'warning'}>{data.status}</Badge>
      <div className="grid gap-3 md:grid-cols-2">
        {Object.entries(data.checks ?? {}).map(([name, check]) => (
          <Card key={name}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                {name}
                <Badge variant={check.ok ? 'success' : 'destructive'}>
                  {check.ok ? 'ok' : 'falha'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {check.detail || '—'}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
