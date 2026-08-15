const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp']);

export const MAX_INGEST_SECONDS = 3600;

export function isAllowedVideo(file: { type: string; size: number; name?: string }) {
  const name = String(file.name ?? '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  const extOk = /\.(mp4|mov|webm|m4v|3gp)$/i.test(name);
  if (file.size < 10_000) return false;
  if (!type || type === 'application/octet-stream') return extOk;
  return VIDEO_TYPES.has(type) || extOk;
}

export function mp4DurationSeconds(bytes: Buffer): number | null {
  const marker = Buffer.from('mvhd');
  let from = 0;
  while (from + 24 <= bytes.length) {
    const idx = bytes.indexOf(marker, from);
    if (idx < 0 || idx + 24 > bytes.length) return null;
    const version = bytes[idx + 4];
    try {
      if (version === 0) {
        const timescale = bytes.readUInt32BE(idx + 16);
        const duration = bytes.readUInt32BE(idx + 20);
        if (timescale > 0 && duration > 0) return duration / timescale;
      } else if (version === 1 && idx + 36 <= bytes.length) {
        const timescale = bytes.readUInt32BE(idx + 24);
        const duration = Number(bytes.readBigUInt64BE(idx + 28));
        if (timescale > 0 && duration > 0) return duration / timescale;
      }
    } catch {
      return null;
    }
    from = idx + 4;
  }
  return null;
}
