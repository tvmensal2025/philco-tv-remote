'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Zap } from 'lucide-react';

type Restaurant = { id: string; name: string; timezone: string; settings: Record<string, unknown> };

export default function AutomationSettings({
  restaurants,
  role,
}: {
  restaurants: Restaurant[];
  role: string;
}) {
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? '');
  const restaurant = restaurants.find((item) => item.id === restaurantId);
  const [enabled, setEnabled] = useState(Boolean(restaurant?.settings.auto_capture_motion));
  const [autoHighlights, setAutoHighlights] = useState(
    restaurant?.settings.auto_highlights !== false,
  );
  const [dailyCap, setDailyCap] = useState(
    Number(restaurant?.settings.max_auto_reels_per_day ?? 24),
  );
  const [minScore, setMinScore] = useState(Number(restaurant?.settings.highlight_min_score ?? 58));
  const [whatsappDaily, setWhatsappDaily] = useState(Boolean(restaurant?.settings.whatsapp_daily));
  const [whatsappPhone, setWhatsappPhone] = useState(
    String(restaurant?.settings.whatsapp_phone ?? ''),
  );
  const [digestHour, setDigestHour] = useState(Number(restaurant?.settings.digest_hour ?? 21));
  const [saving, setSaving] = useState(false);
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
        autoCaptureMotion: enabled,
        autoHighlights,
        maxAutoReelsPerDay: dailyCap,
        highlightMinScore: minScore,
        whatsappDaily,
        whatsappPhone,
        digestHour,
      }),
    });
    const data = await response.json();
    setSaving(false);
    if (response.ok) toast.success('Automação salva');
    else toast.error(data.error ?? 'Não foi possível salvar.');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" /> O que roda sozinho
          </CardTitle>
          <CardDescription>
            O sistema acha os picos do turno e corta Reels. Você só aprova o que vai ao ar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {restaurants.length > 1 ? (
            <label className="space-y-1 text-sm font-medium">
              Restaurante
              <select
                className="block h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
                value={restaurantId}
                onChange={(event) => {
                  const next = restaurants.find((item) => item.id === event.target.value);
                  setRestaurantId(event.target.value);
                  setEnabled(Boolean(next?.settings.auto_capture_motion));
                  setAutoHighlights(next?.settings.auto_highlights !== false);
                  setDailyCap(Number(next?.settings.max_auto_reels_per_day ?? 24));
                  setMinScore(Number(next?.settings.highlight_min_score ?? 58));
                  setWhatsappDaily(Boolean(next?.settings.whatsapp_daily));
                  setWhatsappPhone(String(next?.settings.whatsapp_phone ?? ''));
                  setDigestHour(Number(next?.settings.digest_hour ?? 21));
                }}
              >
                {restaurants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <p className="font-medium">Cortar quando houver movimento</p>
              <p className="text-sm text-muted-foreground">
                Usa a janela de segundos antes e depois definida em Ajustes.
              </p>
            </div>
            <Switch checked={enabled} disabled={!canEdit} onCheckedChange={setEnabled} />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <p className="font-medium">Destaques sozinhos no turno</p>
              <p className="text-sm text-muted-foreground">
                Varre os pedaços, acha os picos e só manda os segundos bons para a edição.
              </p>
            </div>
            <Switch
              checked={autoHighlights}
              disabled={!canEdit}
              onCheckedChange={setAutoHighlights}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Máximo de Reels automáticos por dia
            <input
              className="block h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
              type="number"
              min={0}
              max={200}
              value={dailyCap}
              disabled={!canEdit}
              onChange={(event) => setDailyCap(Number(event.target.value))}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Nota mínima do destaque
            <input
              className="block h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
              type="number"
              min={0}
              max={100}
              value={minScore}
              disabled={!canEdit}
              onChange={(event) => setMinScore(Number(event.target.value))}
            />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <p className="font-medium">Resumo no WhatsApp no fim do dia</p>
              <p className="text-sm text-muted-foreground">
                Envia os melhores Reels do turno para o número da casa.
              </p>
            </div>
            <Switch
              checked={whatsappDaily}
              disabled={!canEdit}
              onCheckedChange={setWhatsappDaily}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            WhatsApp da casa
            <input
              className="block h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
              inputMode="tel"
              placeholder="5511999999999"
              value={whatsappPhone}
              disabled={!canEdit}
              onChange={(event) => setWhatsappPhone(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Hora do envio
            <input
              className="block h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
              type="number"
              min={0}
              max={23}
              value={digestHour}
              disabled={!canEdit}
              onChange={(event) => setDigestHour(Number(event.target.value))}
            />
          </label>
          {canEdit ? (
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar automação'}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
