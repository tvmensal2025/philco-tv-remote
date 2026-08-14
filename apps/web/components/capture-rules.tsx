'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';

type Restaurant = { id: string; name: string; timezone: string; settings: Record<string, unknown> };

export default function CaptureRules({
  restaurants,
  role,
}: {
  restaurants: Restaurant[];
  role: string;
}) {
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? '');
  const restaurant = restaurants.find((item) => item.id === restaurantId);
  const [prompt, setPrompt] = useState(
    String(
      restaurant?.settings.capture_prompt ??
        'Priorize comida, movimento no balcão e rostos visíveis da equipe.',
    ),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const canEdit = ['owner', 'admin'].includes(role);

  async function save() {
    if (!restaurant) return;
    setSaving(true);
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        restaurantId: restaurant.id,
        name: restaurant.name,
        timezone: restaurant.timezone,
        windowBefore: Number(restaurant.settings.window_before ?? 12),
        windowAfter: Number(restaurant.settings.window_after ?? 8),
        activeStyle: restaurant.settings.active_style ?? 'natural',
        capturePrompt: prompt,
      }),
    });
    const data = await response.json();
    setSaving(false);
    setMessage(response.ok ? 'Regras salvas.' : data.error);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Direcionamento de captura
          </CardTitle>
          <CardDescription>
            Esse texto diz ao editor o que priorizar: comida, gesto, sala, equipe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="space-y-1 text-sm font-medium">
            Restaurante
            <select
              className="block h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
              value={restaurantId}
              onChange={(event) => {
                const next = restaurants.find((item) => item.id === event.target.value);
                setRestaurantId(event.target.value);
                setPrompt(
                  String(
                    next?.settings.capture_prompt ??
                      'Priorize comida, movimento no balcão e rostos visíveis da equipe.',
                  ),
                );
              }}
            >
              {restaurants.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <textarea
            disabled={!canEdit}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={6}
            className="w-full rounded-md border bg-background p-3 text-sm"
          />
          {canEdit && (
            <Button onClick={save} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar regras'}
            </Button>
          )}
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
