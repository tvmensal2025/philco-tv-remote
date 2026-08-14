'use client';

import { Check, Film, Gauge, Sparkles, WandSparkles } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const options = [
  {
    id: 'natural',
    title: 'Natural',
    tag: 'Recomendado',
    description: 'Cortes suaves que preservam a atmosfera real do restaurante.',
    cut: 'Cortes naturais',
    rhythm: 'Ritmo equilibrado',
  },
  {
    id: 'dynamic',
    title: 'Dinâmico',
    tag: 'Mais energia',
    description: 'Trocas rápidas de câmera, ritmo forte e foco em ação.',
    cut: 'Cortes rápidos',
    rhythm: 'Ritmo intenso',
  },
  {
    id: 'cinematic',
    title: 'Cinematográfico',
    tag: 'Premium',
    description: 'Ritmo elegante, planos mais longos e presença visual sofisticada.',
    cut: 'Planos elegantes',
    rhythm: 'Ritmo suave',
  },
] as const;

type Restaurant = { id: string; name: string; timezone: string; settings: Record<string, unknown> };

export default function StylesManager({
  restaurants,
  role,
}: {
  restaurants: Restaurant[];
  role: string;
}) {
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? '');
  const restaurant = restaurants.find((item) => item.id === restaurantId);
  const [activeByRestaurant, setActiveByRestaurant] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      restaurants.map((item) => [item.id, String(item.settings.active_style ?? 'natural')]),
    ),
  );
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const canEdit = ['owner', 'admin'].includes(role);
  const active = activeByRestaurant[restaurantId] ?? 'natural';

  async function select(style: (typeof options)[number]['id']) {
    if (!restaurant || !canEdit || saving) return;
    setSaving(style);
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        restaurantId: restaurant.id,
        name: restaurant.name,
        timezone: restaurant.timezone,
        windowBefore: Number(restaurant.settings.window_before ?? 12),
        windowAfter: Number(restaurant.settings.window_after ?? 8),
        activeStyle: style,
      }),
    });
    const data = await response.json();
    setSaving('');
    if (response.ok) {
      setActiveByRestaurant((current) => ({ ...current, [restaurantId]: style }));
      setMessage(`Estilo ${options.find((item) => item.id === style)?.title} ativado.`);
    } else setMessage(data.error);
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <WandSparkles className="h-3.5 w-3.5" /> Ritmo do corte
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Escolha o ritmo da sua história.
          </h2>
          <p className="text-sm text-muted-foreground">
            O estilo escolhido manda no ritmo dos próximos Reels.
          </p>
        </div>
        <label className="space-y-1 text-sm font-medium">
          Restaurante
          <select
            className="block h-10 rounded-md border bg-background px-3 text-sm font-normal"
            value={restaurantId}
            onChange={(event) => setRestaurantId(event.target.value)}
          >
            {restaurants.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {options.map((style) => (
          <Card key={style.id} className={cn(active === style.id && 'border-primary')}>
            <CardHeader>
              <Badge variant="secondary" className="w-fit">
                {style.tag}
              </Badge>
              <CardTitle>{style.title}</CardTitle>
              <CardDescription>{style.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Film className="h-4 w-4" /> {style.cut}
              </p>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Gauge className="h-4 w-4" /> {style.rhythm}
              </p>
              <Button
                disabled={!canEdit || Boolean(saving)}
                className="w-full"
                variant={active === style.id ? 'default' : 'outline'}
                onClick={() => select(style.id)}
              >
                {active === style.id ? (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Estilo ativo
                  </>
                ) : saving === style.id ? (
                  'Salvando…'
                ) : (
                  'Selecionar estilo'
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex gap-3 p-6">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium">Em breve: estilos personalizados com sua marca</p>
            <p className="text-sm text-muted-foreground">
              Logo, trilha, tipografia e cores aplicados automaticamente a cada Reel.
            </p>
          </div>
        </CardContent>
      </Card>

      {message && (
        <div
          className="fixed bottom-4 right-4 z-50 rounded-md border bg-background px-4 py-3 shadow"
          role="status"
        >
          <span>{message}</span>
          <button className="ml-3 text-muted-foreground" onClick={() => setMessage('')}>
            ×
          </button>
        </div>
      )}
    </section>
  );
}
