import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { analyzePcm, BEAT_SAMPLE_RATE, type MusicAnalysis } from '@reelops/shared';
import { ffmpegSlot } from '../engine/provider-slots.js';

const cache = new Map<string, MusicAnalysis>();

function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

export async function decodeMonoPcm(
  source: string,
  maxSeconds = 90,
  sampleRate = BEAT_SAMPLE_RATE,
): Promise<Float32Array> {
  return ffmpegSlot.run(
    () =>
      new Promise<Float32Array>((resolve, reject) => {
        const child = spawn(
          ffmpegBin(),
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            source,
            '-t',
            String(maxSeconds),
            '-ac',
            '1',
            '-ar',
            String(sampleRate),
            '-f',
            'f32le',
            'pipe:1',
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const chunks: Buffer[] = [];
        let stderr = '';
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('FFMPEG_TIMEOUT'));
        }, 30_000);
        child.stdout.on('data', (data: Buffer) => chunks.push(data));
        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        child.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.on('close', (code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            reject(new Error(`ffmpeg (${code}): ${stderr.slice(-800)}`));
            return;
          }
          const buffer = Buffer.concat(chunks);
          const aligned = buffer.byteOffset % 4 === 0 ? buffer : Buffer.from(buffer);
          const samples = new Float32Array(
            aligned.buffer,
            aligned.byteOffset,
            Math.floor(aligned.byteLength / 4),
          );
          resolve(samples.slice());
        });
      }),
  );
}

export async function analyzeMusicFile(source: string): Promise<MusicAnalysis> {
  let stamp = source;
  try {
    const info = await stat(source);
    stamp = `${source}:${info.mtimeMs}:${info.size}`;
  } catch {
    stamp = source;
  }
  const hit = cache.get(stamp);
  if (hit) return hit;
  const samples = await decodeMonoPcm(source);
  if (samples.length < BEAT_SAMPLE_RATE) {
    const empty = analyzePcm(samples, BEAT_SAMPLE_RATE);
    cache.set(stamp, empty);
    return empty;
  }
  const analysis = analyzePcm(samples, BEAT_SAMPLE_RATE);
  cache.set(stamp, analysis);
  return analysis;
}
