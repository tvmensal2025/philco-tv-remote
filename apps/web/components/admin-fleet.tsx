'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { restaurantOpsLabels, type RestaurantOpsCode } from '@/lib/restaurant-ops';

type Row = {
  id: string;
  name: string;
  tenantName: string;
  tenantPlan: string;
  code: RestaurantOpsCode;
  camerasOnline: number;
  camerasEnabled: number;
  lastSeenMs: number | null;
  readyToday: number;
  failedToday: number;
  queuedToday: number;
};

const tone: Record<
  RestaurantOpsCode,
  'success' | 'warning' | 'destructive' | 'outline' | 'secondary'
> = {
  live: 'success',
  degraded: 'warning',
  silent: 'destructive',
  never: 'outline',
  paused: 'secondary',
};

function ageLabel(ms: number | null) {
  if (ms == null) return 'nunca';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 3_600_000)} h`;
}

export default function AdminFleet() {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/restaurants')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Falha ao carregar a frota');
        setRows(body.restaurants ?? []);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro'));
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => `${row.name} ${row.tenantName}`.toLowerCase().includes(needle));
  }, [query, rows]);

  const counts = {
    live: rows.filter((row) => row.code === 'live').length,
    degraded: rows.filter((row) => row.code === 'degraded').length,
    silent: rows.filter((row) => row.code === 'silent').length,
    never: rows.filter((row) => row.code === 'never').length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Frota</h1>
        <p className="text-sm text-muted-foreground">
          Cada linha é uma casa. A pergunta é se ela está filmando agora.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Ao vivo</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{counts.live}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Degradado</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{counts.degraded}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Mudo</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{counts.silent}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Nunca</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{counts.never}</CardContent>
        </Card>
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar casa ou empresa"
        className="max-w-sm"
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Casa</th>
              <th className="px-4 py-3 font-medium">Câmeras</th>
              <th className="px-4 py-3 font-medium">Último segmento</th>
              <th className="px-4 py-3 font-medium">Reels hoje</th>
              <th className="px-4 py-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/restaurants/${row.id}`}
                    className="font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {row.tenantName} · {row.tenantPlan}
                  </p>
                </td>
                <td className="px-4 py-3">
                  {row.camerasOnline}/{row.camerasEnabled || 4}
                </td>
                <td className="px-4 py-3">{ageLabel(row.lastSeenMs)}</td>
                <td className="px-4 py-3">
                  {row.readyToday} ready · {row.failedToday} fail · {row.queuedToday} fila
                </td>
                <td className="px-4 py-3">
                  <Badge variant={tone[row.code]}>{restaurantOpsLabels[row.code]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
