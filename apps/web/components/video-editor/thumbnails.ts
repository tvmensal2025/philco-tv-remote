const cache = new Map<string, string[]>();

export async function filmstripForMedia(
  url: string,
  mediaId: string,
  durationMs: number,
  count = 8,
): Promise<string[]> {
  const hit = cache.get(mediaId);
  if (hit) return hit;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('thumb'));
  });
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const frames: string[] = [];
  const span = Math.max(200, durationMs);
  for (let i = 0; i < count; i += 1) {
    const t = (span / 1000) * ((i + 0.5) / count);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = Math.min(Math.max(0.05, t), Math.max(0.1, video.duration - 0.05));
    });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(canvas.toDataURL('image/jpeg', 0.62));
  }
  video.src = '';
  cache.set(mediaId, frames);
  return frames;
}
