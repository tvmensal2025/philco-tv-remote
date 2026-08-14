'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { restaurantOpsLabels, type RestaurantOpsCode } from '@/lib/restaurant-ops';

type Payload = {
  restaurant: {
    id: string;
    name: string;
    timezone: string;
    tenantName: string;
    tenantPlan: string;
    tenantSlug: string;
  };
  ops: {
    code: RestaurantOpsCode;
    camerasOnline: number;
    camerasEnabled: number;
    failedToday: number;
    readyToday: number;
  };
  cameras: {
    id: string;
    name: string;
    position: number;
    enabled: boolean;
    last_seen_at: string | null;
    last_segment_path: string | null;
    role: string | null;
  }[];
  reels: {
    id: string;
    status: string;
    title: string | null;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
    progress: number;
  }[];
  members: { user_id: string; role: string; created_at: string }[];
  recordings: {
    id: string;
    camera_id: string;
    started_at: string;
    duration_seconds: number | null;
    timestamp_confidence: string | null;
  }[];
};

export default function AdminRestaurantDetail({ restaurantId }: { restaurantId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/admin/restaurants/${restaurantId}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Falha ao carregar a casa');
        setData(body);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro'));
  }, [restaurantId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Carregando a casa…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-muted-foreground hover:underline">
          Frota
        </Link>
        <h1 className="font-heading text-2xl font-semibold">{data.restaurant.name}</h1>
        <p className="text-sm text-muted-foreground">
          {data.restaurant.tenantName} · {data.restaurant.timezone} · {data.restaurant.tenantPlan}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge>{restaurantOpsLabels[data.ops.code]}</Badge>
        <Badge variant="outline">
          {data.ops.camerasOnline}/{data.ops.camerasEnabled} câmeras
        </Badge>
        <Badge variant="outline">{data.ops.readyToday} reels ready</Badge>
        <Badge variant={data.ops.failedToday ? 'destructive' : 'outline'}>
          {data.ops.failedToday} failed
        </Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Câmeras</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.cameras.map((camera) => (
            <div
              key={camera.id}
              className="flex flex-wrap justify-between gap-2 border-b py-2 last:border-0"
            >
              <span>
                C{camera.position} · {camera.name} · {camera.role ?? '—'}
              </span>
              <span className="text-muted-foreground">
                {camera.enabled ? 'ligada' : 'pausada'} ·{' '}
                {camera.last_seen_at
                  ? new Date(camera.last_seen_at).toLocaleString('pt-BR')
                  : 'nunca'}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Reels recentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.reels.map((reel) => (
            <div
              key={reel.id}
              className="flex flex-wrap justify-between gap-2 border-b py-2 last:border-0"
            >
              <span>
                {reel.title || reel.id.slice(0, 8)} · {reel.status}
                {reel.progress ? ` ${reel.progress}%` : ''}
              </span>
              <span className="text-muted-foreground">
                {reel.error_code ?? new Date(reel.created_at).toLocaleString('pt-BR')}
              </span>
            </div>
          ))}
          {!data.reels.length ? <p className="text-muted-foreground">Nenhum reel ainda.</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Últimos segmentos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.recordings.map((recording) => (
            <div
              key={recording.id}
              className="flex flex-wrap justify-between gap-2 border-b py-2 last:border-0"
            >
              <span>{new Date(recording.started_at).toLocaleString('pt-BR')}</span>
              <span className="text-muted-foreground">
                {recording.duration_seconds ?? '—'}s · {recording.timestamp_confidence ?? '—'}
              </span>
            </div>
          ))}
          {!data.recordings.length ? (
            <p className="text-muted-foreground">Nenhum segmento no banco.</p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Membros da casa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.members.map((member) => (
            <div key={member.user_id} className="flex justify-between gap-2">
              <span className="font-mono text-xs">{member.user_id}</span>
              <span>{member.role}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
