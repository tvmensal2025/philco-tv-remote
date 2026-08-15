import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateTechnicalQuality, type MediaProbe } from '@reelops/shared';
import { deliveryAudioEncodeArgs, deliveryAudioFilter } from './audio.js';

function run(binary: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('timeout'));
    }, 20_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout || stderr);
      else reject(new Error(`${binary} ${code}: ${stderr.slice(-400)}`));
    });
  });
}

async function probe(file: string): Promise<MediaProbe> {
  const raw = await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  const json = JSON.parse(raw) as {
    format?: { duration?: string; size?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      sample_rate?: string;
      channels?: number;
      channel_layout?: string;
    }>;
  };
  const video = (json.streams ?? []).find((stream) => stream.codec_type === 'video');
  const audio = (json.streams ?? []).find((stream) => stream.codec_type === 'audio');
  return {
    sizeBytes: Number(json.format?.size) || 0,
    durationSeconds: Number(json.format?.duration) || 0,
    video: video
      ? { codec: video.codec_name, width: video.width, height: video.height, pixFmt: video.pix_fmt }
      : undefined,
    audio: audio
      ? {
          codec: audio.codec_name,
          sampleRate: audio.sample_rate ? Number(audio.sample_rate) : undefined,
          channels: audio.channels,
          channelLayout: audio.channel_layout,
        }
      : null,
  };
}

describe('technical QC with real ffmpeg', () => {
  it('passes a 1080x1920 h264+aac fixture and blocks truncated / no-video outputs', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'qc-'));
    try {
      const valid = path.join(dir, 'valid.mp4');
      const audioOnly = path.join(dir, 'audio.m4a');
      const truncated = path.join(dir, 'truncated.mp4');
      await run('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=1080x1920:r=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-t',
        '1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-shortest',
        valid,
      ]);
      await run('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=48000:cl=stereo',
        '-t',
        '1',
        '-c:a',
        'aac',
        audioOnly,
      ]);
      await writeFile(truncated, Buffer.alloc(32));
      const good = evaluateTechnicalQuality(await probe(valid), {
        videoCodec: 'h264',
        pixFmt: 'yuv420p',
        requireAudio: true,
      });
      expect(good.status).toBe('passed');
      expect(good.probe.video?.width).toBe(1080);
      expect(good.probe.video?.height).toBe(1920);
      const noVideo = evaluateTechnicalQuality(await probe(audioOnly), { requireAudio: true });
      expect(noVideo.status).toBe('failed');
      expect(noVideo.issues.some((issue) => issue.code === 'NO_VIDEO_STREAM')).toBe(true);
      let truncatedFailed = false;
      try {
        const report = evaluateTechnicalQuality(await probe(truncated));
        truncatedFailed = report.status === 'failed';
      } catch {
        truncatedFailed = true;
      }
      expect(truncatedFailed).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it('normalizes 96 kHz mono camera audio to AAC 48 kHz stereo', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'qc-audio-'));
    try {
      const source = path.join(dir, 'camera-96k-mono.mp4');
      const delivery = path.join(dir, 'delivery.mp4');
      await run('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=1080x1920:r=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=96000',
        '-t',
        '1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-ar',
        '96000',
        '-ac',
        '1',
        '-shortest',
        source,
      ]);
      const camera = evaluateTechnicalQuality(await probe(source), {
        videoCodec: 'h264',
        pixFmt: 'yuv420p',
        requireAudio: true,
      });
      expect(camera.status).toBe('failed');
      expect(camera.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(['AUDIO_RATE', 'AUDIO_CHANNELS']),
      );
      await run('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        source,
        '-map',
        '0:v',
        '-map',
        '0:a',
        '-c:v',
        'copy',
        '-af',
        deliveryAudioFilter(),
        ...deliveryAudioEncodeArgs(),
        delivery,
      ]);
      const probed = await probe(delivery);
      expect(probed.audio).toMatchObject({
        codec: 'aac',
        sampleRate: 48000,
        channels: 2,
      });
      expect(probed.audio?.channelLayout).toMatch(/stereo|2\.0/i);
      const report = evaluateTechnicalQuality(probed, {
        videoCodec: 'h264',
        pixFmt: 'yuv420p',
        requireAudio: true,
      });
      expect(report.status).toBe('passed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 40_000);
});
