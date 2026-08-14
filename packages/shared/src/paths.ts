export const STORAGE_ROOT = 'cenapronta';

export function calendarDay(value: Date | string, timeZone = 'America/Sao_Paulo') {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function slugifyName(value: string) {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'reel'
  );
}

export function cameraStoragePrefix(tenantId: string, restaurantId: string, position: number) {
  return `${STORAGE_ROOT}/raw/${tenantId}/${restaurantId}/camera-${position}`;
}

export function rawSegmentPath(
  tenantId: string,
  restaurantId: string,
  position: number,
  capturedAt: Date,
) {
  return `${cameraStoragePrefix(tenantId, restaurantId, position)}/${calendarDay(capturedAt)}/${capturedAt.toISOString()}.mp4`;
}

export function peopleDayPrefix(tenantId: string, restaurantId: string, day: string) {
  return `${STORAGE_ROOT}/people/${tenantId}/${restaurantId}/${day}`;
}

export function reelRenderPrefix(
  tenantId: string,
  restaurantId: string,
  day: string,
  reelId: string,
) {
  return `${peopleDayPrefix(tenantId, restaurantId, day)}/reels/${reelId}`;
}

export function dailyRankedReelPath(
  tenantId: string,
  restaurantId: string,
  day: string,
  rank: number,
  reelId: string,
  title?: string,
) {
  const rankLabel = String(rank).padStart(2, '0');
  const slug = slugifyName(title ?? 'destaque');
  return `${peopleDayPrefix(tenantId, restaurantId, day)}/reels/${rankLabel}-${slug}-${reelId.slice(0, 8)}.mp4`;
}

export function isTenantMediaPath(objectPath: string, tenantId: string) {
  return (
    objectPath.startsWith(`${STORAGE_ROOT}/raw/${tenantId}/`) ||
    objectPath.startsWith(`${STORAGE_ROOT}/people/${tenantId}/`) ||
    objectPath.startsWith(`raw/${tenantId}/`) ||
    objectPath.startsWith(`generated/reels/${tenantId}/`)
  );
}

export function clockHour(value: Date | string, timeZone = 'America/Sao_Paulo') {
  const date = value instanceof Date ? value : new Date(value);
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .find((part) => part.type === 'hour')?.value;
  return Number(hour ?? 0);
}

export function normalizeWhatsappPhone(value: string) {
  return value.replace(/\D/g, '');
}
