import { basename, extname } from 'node:path';
import { statSync } from 'node:fs';

const CANONICAL = /^(cam-?0*(\d+)|camera-?0*(\d+))[_\-](\d{8}T\d{6})[_\-](\d{8}T\d{6})\.mp4$/i;

export function parseCompactStamp(value, timezoneOffset = '-03:00') {
  if (!/^\d{8}T\d{6}$/.test(value)) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}${timezoneOffset}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class FilenameTimestampResolver {
  canResolve(file) {
    return CANONICAL.test(basename(file));
  }

  async resolve(file, source) {
    const match = basename(file).match(CANONICAL);
    if (!match) throw new Error('FILENAME_TIMESTAMP_UNMATCHED');
    const startedAt = parseCompactStamp(match[4], source?.timezoneOffset);
    const endedAt = parseCompactStamp(match[5], source?.timezoneOffset);
    if (!startedAt || !endedAt || endedAt <= startedAt)
      throw new Error('FILENAME_TIMESTAMP_INVALID');
    return {
      startedAt,
      endedAt,
      confidence: 'exact',
      source: 'filename',
      position: Number(match[2] || match[3]),
    };
  }
}

export class NvrPatternTimestampResolver {
  canResolve(file, source) {
    return Boolean(source?.filenamePattern) && extname(file).toLowerCase() === '.mp4';
  }

  async resolve(file, source) {
    const match = basename(file).match(new RegExp(source.filenamePattern));
    if (!match) throw new Error('NVR_PATTERN_UNMATCHED');
    const startRaw = match.groups?.start ?? match[1];
    const endRaw = match.groups?.end ?? match[2];
    const startedAt = parseStamp(startRaw, source?.timezoneOffset);
    const endedAt = parseStamp(endRaw, source?.timezoneOffset);
    if (!startedAt || !endedAt || endedAt <= startedAt) throw new Error('NVR_PATTERN_INVALID');
    return {
      startedAt,
      endedAt,
      confidence: 'exact',
      source: 'nvr_pattern',
      position: source?.position,
    };
  }
}

export class FileMetadataTimestampResolver {
  canResolve(_file, _source, probe) {
    return Boolean(probe?.creationTime) && probe.duration > 0;
  }

  async resolve(_file, _source, probe) {
    const startedAt = new Date(probe.creationTime);
    if (Number.isNaN(startedAt.getTime())) throw new Error('FILE_METADATA_INVALID');
    return {
      startedAt,
      endedAt: new Date(startedAt.getTime() + probe.duration * 1000),
      confidence: 'derived',
      source: 'file_metadata',
    };
  }
}

export class FallbackTimestampResolver {
  canResolve() {
    return true;
  }

  async resolve(file, _source, probe) {
    const mtime = statSync(file).mtime;
    const durationMs = probe?.duration > 0 ? probe.duration * 1000 : 60_000;
    return {
      startedAt: new Date(mtime.getTime() - durationMs),
      endedAt: mtime,
      confidence: 'fallback',
      source: 'filesystem_mtime',
    };
  }
}

export function parseStamp(value, timezoneOffset = '-03:00') {
  if (!value) return null;
  if (/^\d{8}T\d{6}$/.test(value)) return parseCompactStamp(value, timezoneOffset);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function resolveTimestamp(file, source, probe) {
  const resolvers = [
    new FilenameTimestampResolver(),
    new NvrPatternTimestampResolver(),
    new FileMetadataTimestampResolver(),
    new FallbackTimestampResolver(),
  ];
  for (const resolver of resolvers) {
    if (!resolver.canResolve(file, source, probe)) continue;
    try {
      const result = await resolver.resolve(file, source, probe);
      if (result?.startedAt && result?.endedAt) return result;
    } catch {
      // try the next resolver; fallback is last and always succeeds
    }
  }
  throw new Error('TIMESTAMP_UNRESOLVED');
}
