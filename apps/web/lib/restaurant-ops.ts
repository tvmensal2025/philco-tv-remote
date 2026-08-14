export type RestaurantOpsCode = 'live' | 'degraded' | 'silent' | 'never' | 'paused';

export type CameraSignal = {
  last_seen_at: string | null;
  enabled: boolean;
};

export type ReelSignal = {
  status: string;
};

const LIVE_MS = 20 * 60 * 1000;
const SILENT_MS = 3 * 60 * 60 * 1000;

export function restaurantOpsStatus(input: {
  cameras: CameraSignal[];
  reelsToday: ReelSignal[];
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const enabled = input.cameras.filter((camera) => camera.enabled);
  const camerasEnabled = enabled.length;
  const camerasOnline = enabled.filter((camera) => {
    if (!camera.last_seen_at) return false;
    const age = now - Date.parse(camera.last_seen_at);
    return Number.isFinite(age) && age <= LIVE_MS;
  }).length;
  const lastSeen = enabled.reduce((min, camera) => {
    if (!camera.last_seen_at) return min;
    const age = now - Date.parse(camera.last_seen_at);
    return Number.isFinite(age) ? Math.min(min, age) : min;
  }, Infinity);
  const failedToday = input.reelsToday.filter((reel) => reel.status === 'failed').length;
  const readyToday = input.reelsToday.filter((reel) =>
    ['ready', 'approved', 'published', 'publishing'].includes(reel.status),
  ).length;
  const queuedToday = input.reelsToday.filter((reel) =>
    ['queued', 'collecting', 'analyzing', 'rendering', 'uploading'].includes(reel.status),
  ).length;

  let code: RestaurantOpsCode = 'degraded';
  if (!input.cameras.length) code = 'never';
  else if (camerasEnabled === 0) code = 'paused';
  else if (enabled.every((camera) => !camera.last_seen_at)) code = 'never';
  else if (camerasOnline === camerasEnabled && failedToday === 0) code = 'live';
  else if (lastSeen > SILENT_MS) code = 'silent';
  else code = 'degraded';

  return {
    code,
    camerasOnline,
    camerasEnabled,
    lastSeenMs: lastSeen === Infinity ? null : lastSeen,
    failedToday,
    readyToday,
    queuedToday,
  };
}

export const restaurantOpsLabels: Record<RestaurantOpsCode, string> = {
  live: 'Ao vivo',
  degraded: 'Degradado',
  silent: 'Mudo no turno',
  never: 'Nunca conectou',
  paused: 'Pausado',
};
