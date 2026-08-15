export const IN_FLIGHT_STATUSES = [
  'queued',
  'collecting',
  'analyzing',
  'rendering',
  'uploading',
] as const;

export const READY_STATUSES = ['ready', 'approved', 'published', 'publishing'] as const;

export type HouseReel = {
  id: string;
  status: string;
  created_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  title?: string | null;
};

export function zonedDayKey(value: string | Date, timeZone: string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function zonedHour(value: string, timeZone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(date),
  );
  return Number.isFinite(hour) ? hour : null;
}

export function greetingForHour(hour: number) {
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function lastSevenDays(now: Date, timeZone: string) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getTime() - (6 - index) * 86_400_000);
    const key = zonedDayKey(date, timeZone);
    const label = new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      weekday: 'short',
    })
      .format(date)
      .replace('.', '')
      .replace(/^\w/, (letter) => letter.toUpperCase());
    return { key, label };
  });
}

export function todayCounts(reels: HouseReel[], timeZone: string, now = new Date()) {
  const today = zonedDayKey(now, timeZone);
  const todays = reels.filter((reel) => zonedDayKey(reel.created_at ?? '', timeZone) === today);
  return {
    ready: todays.filter((reel) =>
      READY_STATUSES.includes(reel.status as (typeof READY_STATUSES)[number]),
    ).length,
    queued: todays.filter((reel) =>
      IN_FLIGHT_STATUSES.includes(reel.status as (typeof IN_FLIGHT_STATUSES)[number]),
    ).length,
    toApprove: todays.filter((reel) => reel.status === 'ready').length,
    failed: todays.filter((reel) => reel.status === 'failed').length,
  };
}

export function readyByDay(reels: HouseReel[], timeZone: string, now = new Date()) {
  const days = lastSevenDays(now, timeZone);
  return days.map((day) => ({
    day: day.label,
    prontos: reels.filter(
      (reel) =>
        zonedDayKey(reel.created_at ?? '', timeZone) === day.key &&
        READY_STATUSES.includes(reel.status as (typeof READY_STATUSES)[number]),
    ).length,
  }));
}

export function hourBars(
  moments: { occurred_at: string }[],
  timeZone: string,
  fromHour = 8,
  toHour = 22,
) {
  const hours = Array.from({ length: toHour - fromHour + 1 }, (_, index) => {
    const hour = fromHour + index;
    return { hour, label: `${String(hour).padStart(2, '0')}h`, cortes: 0 };
  });
  for (const moment of moments) {
    const hour = zonedHour(moment.occurred_at, timeZone);
    if (hour == null || hour < fromHour || hour > toHour) continue;
    hours[hour - fromHour].cortes += 1;
  }
  return hours;
}

export function humanReelFailure(code?: string | null, message?: string | null) {
  const raw = `${code ?? ''} ${message ?? ''}`;
  if (/SKIP_PROGRAM/i.test(raw)) return 'Este corte não tinha ângulo suficiente.';
  if (/QUEUE/i.test(raw)) return 'A fila estava indisponível. Tente de novo.';
  if (/STALE_JOB/i.test(raw)) return 'O corte parou no meio. Pode gerar de novo.';
  if (/NO_CAMERA|NO_SCENES/i.test(raw)) return 'Não havia imagem neste instante.';
  return 'O corte não saiu. Abra o filme para tentar de novo.';
}
