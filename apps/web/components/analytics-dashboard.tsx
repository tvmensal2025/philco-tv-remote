'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
} from 'recharts';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';

type RawMoment = { occurred_at: string };
type RawReel = { created_at: string; status: string; score: number | null };

export default function AnalyticsDashboard({
  rawMoments,
  rawReels,
}: {
  rawMoments: RawMoment[];
  rawReels: RawReel[];
}) {
  const { momentsData, reelsData, scoreData, heatMapValues } = useMemo(() => {
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

    // Initialize defaults for the last 7 days
    const last7Days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return {
        dateKey: d.toISOString().split('T')[0],
        day: days[d.getDay()],
        moments: 0,
        aprovados: 0,
        descartados: 0,
        scoreSum: 0,
        scoreCount: 0,
        score: 0,
      };
    });

    const heatMap = new Array(11).fill(0); // 08h to 18h

    rawMoments.forEach((m) => {
      const date = new Date(m.occurred_at);
      const dateKey = date.toISOString().split('T')[0];
      const dayData = last7Days.find((d) => d.dateKey === dateKey);
      if (dayData) dayData.moments++;

      const hour = date.getHours();
      if (hour >= 8 && hour <= 18) {
        heatMap[hour - 8]++;
      }
    });

    rawReels.forEach((r) => {
      const date = new Date(r.created_at);
      const dateKey = date.toISOString().split('T')[0];
      const dayData = last7Days.find((d) => d.dateKey === dateKey);
      if (dayData) {
        if (r.status === 'approved' || r.status === 'published') dayData.aprovados++;
        if (r.status === 'discarded') dayData.descartados++;
        if (r.score) {
          dayData.scoreSum += r.score;
          dayData.scoreCount++;
          dayData.score = Math.round(dayData.scoreSum / dayData.scoreCount);
        }
      }
    });

    return {
      momentsData: last7Days.map((d) => ({ day: d.day, moments: d.moments })),
      reelsData: last7Days.map((d) => ({
        day: d.day,
        aprovados: d.aprovados,
        descartados: d.descartados,
      })),
      scoreData: last7Days.map((d) => ({ day: d.day, score: d.score || null })),
      heatMapValues: heatMap,
    };
  }, [rawMoments, rawReels]);

  const heatMapHours = [
    '08h',
    '09h',
    '10h',
    '11h',
    '12h',
    '13h',
    '14h',
    '15h',
    '16h',
    '17h',
    '18h',
  ];
  const maxHeat = Math.max(...heatMapValues, 1); // Avoid division by zero

  const hasData = rawMoments.length > 0 || rawReels.length > 0;

  if (!hasData) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto pb-12">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
          <p className="text-muted-foreground text-sm">
            Acompanhe a performance do seu conteúdo gerado por IA.
          </p>
        </div>
        <Card className="border-dashed bg-muted/30">
          <CardContent className="flex flex-col items-center justify-center p-16 text-center">
            <h3 className="text-xl font-semibold">Sem dados suficientes</h3>
            <p className="text-muted-foreground mt-2">
              Comece a marcar momentos e gerar Reels para popular os gráficos de análise.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
        <p className="text-muted-foreground text-sm">
          Acompanhe a performance do seu conteúdo gerado por IA.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* AREA CHART */}
        <Card>
          <CardHeader>
            <CardTitle>Momentos Detectados</CardTitle>
            <CardDescription>Volume de eventos registrados por dia</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={momentsData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorMoments" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="moments"
                    stroke="#f97316"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorMoments)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* BAR CHART */}
        <Card>
          <CardHeader>
            <CardTitle>Reels Gerados</CardTitle>
            <CardDescription>Aprovados vs Descartados</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reelsData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                  />
                  <Bar dataKey="aprovados" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="descartados" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* LINE CHART */}
        <Card>
          <CardHeader>
            <CardTitle>ReelScore Médio</CardTitle>
            <CardDescription>Qualidade avaliada pela IA ao longo da semana</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={scoreData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis
                    domain={['auto', 'auto']}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#8b5cf6"
                    strokeWidth={3}
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* HEATMAP / BEST HOURS */}
        <Card>
          <CardHeader>
            <CardTitle>Melhores Horários</CardTitle>
            <CardDescription>Potencial de conteúdo por hora do dia</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 pt-4">
              {heatMapHours.map((hour, idx) => {
                const val = heatMapValues[idx];
                const isMax = val === maxHeat;
                return (
                  <div key={hour} className="flex items-center gap-3">
                    <span className="w-10 text-xs font-medium text-muted-foreground">{hour}</span>
                    <div className="flex-1 h-6 flex items-center">
                      <div
                        className={cn(
                          'h-full rounded-md transition-all',
                          isMax ? 'bg-orange-500' : 'bg-primary/20',
                        )}
                        style={{ width: `${(val / 10) * 100}%` }}
                      ></div>
                    </div>
                    {isMax && <span className="text-xs font-bold text-orange-500">🔥 Pico</span>}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-6 text-center">
              Dica: O horário de 12h-13h concentra o maior potencial para Reels virais na sua
              operação.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
