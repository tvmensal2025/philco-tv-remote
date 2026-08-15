const cache = new Map<string, number[]>();

export async function peaksForMedia(
  url: string,
  mediaId: string,
  bars = 180,
): Promise<number[] | null> {
  const hit = cache.get(mediaId);
  if (hit) return hit;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const ctx = new AudioContext();
    const audio = await ctx.decodeAudioData(buffer.slice(0));
    await ctx.close();
    const channel = audio.getChannelData(0);
    const block = Math.max(1, Math.floor(channel.length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i += 1) {
      let max = 0;
      const start = i * block;
      for (let j = 0; j < block; j += 1) {
        const sample = Math.abs(channel[start + j] ?? 0);
        if (sample > max) max = sample;
      }
      peaks.push(Number(max.toFixed(4)));
    }
    cache.set(mediaId, peaks);
    return peaks;
  } catch {
    return null;
  }
}
