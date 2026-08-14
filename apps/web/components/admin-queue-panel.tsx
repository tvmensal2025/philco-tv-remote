'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type QueueSnapshot = {
  name: string;
  counts: Record<string, number>;
  jobs: {
    id: string;
    failedReason: string | null;
    data: { restaurantId: string | null; reelId: string | null; program: string | null };
  }[];
};

export default function AdminQueuePanel() {
  const [queues, setQueues] = useState<QueueSnapshot[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/queue')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Falha na fila');
        setQueues(body.queues ?? []);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro'));
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Fila</h1>
        <p className="text-sm text-muted-foreground">
          Um FFmpeg de cada vez na KVM. A fila é o produto.
        </p>
      </div>
      <div className="grid gap-4">
        {queues.map((queue) => (
          <Card key={queue.name}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {queue.name}
                <Badge variant="outline">wait {queue.counts.wait ?? 0}</Badge>
                <Badge variant="outline">active {queue.counts.active ?? 0}</Badge>
                <Badge variant={(queue.counts.failed ?? 0) > 0 ? 'destructive' : 'outline'}>
                  failed {queue.counts.failed ?? 0}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {queue.jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex flex-wrap justify-between gap-2 border-b py-2 last:border-0"
                >
                  <span className="font-mono text-xs">{job.id}</span>
                  <span className="text-muted-foreground">
                    {job.data.program ?? '—'} · {job.data.restaurantId?.slice(0, 8) ?? '—'}{' '}
                    {job.failedReason ?? ''}
                  </span>
                </div>
              ))}
              {!queue.jobs.length ? <p className="text-muted-foreground">Fila vazia.</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
