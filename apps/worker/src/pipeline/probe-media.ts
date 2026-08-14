import { stat } from 'node:fs/promises';
import type { MediaProbe } from '@reelops/shared';
import { run } from './ffmpeg.js';

type FfprobeJson = {
  format?: { duration?: string; size?: string; format_name?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    sample_rate?: string;
    channels?: number;
  }>;
};

function fpsOf(value?: string) {
  if (!value || value === '0/0') return undefined;
  const [a, b] = value.split('/').map(Number);
  if (!b) return Number.isFinite(a) ? a : undefined;
  return a / b;
}

export async function probeMedia(file: string): Promise<MediaProbe> {
  const raw = await run(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    30_000,
  );
  const start = raw.indexOf('{');
  const json = JSON.parse(start >= 0 ? raw.slice(start) : raw) as FfprobeJson;
  const video = (json.streams ?? []).find((stream) => stream.codec_type === 'video');
  const audio = (json.streams ?? []).find((stream) => stream.codec_type === 'audio');
  const size = Number(json.format?.size) || (await stat(file)).size;
  return {
    sizeBytes: size,
    durationSeconds: Number(json.format?.duration) || 0,
    formatName: json.format?.format_name,
    video: video
      ? {
          codec: video.codec_name,
          width: video.width,
          height: video.height,
          pixFmt: video.pix_fmt,
          fps: fpsOf(video.avg_frame_rate) ?? fpsOf(video.r_frame_rate),
        }
      : undefined,
    audio: audio
      ? {
          codec: audio.codec_name,
          sampleRate: audio.sample_rate ? Number(audio.sample_rate) : undefined,
          channels: audio.channels,
        }
      : null,
  };
}
