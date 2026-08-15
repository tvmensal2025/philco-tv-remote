import { spawn } from 'node:child_process';

export function probeVideo(file, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:format_tags=creation_time',
      '-show_streams',
      '-of',
      'json',
      file,
    ]);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('FFPROBE_TIMEOUT'));
    }, timeoutMs);
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
      if (code !== 0) {
        reject(new Error(`INCOMPLETE_MEDIA:${stderr.trim().slice(0, 400) || `ffprobe ${code}`}`));
        return;
      }
      try {
        resolve(parseProbe(JSON.parse(stdout)));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('INCOMPLETE_MEDIA'));
      }
    });
  });
}

export function parseProbe(json) {
  const duration = Number(json?.format?.duration);
  const streams = Array.isArray(json?.streams) ? json.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const creationTime =
    json?.format?.tags?.creation_time ??
    json?.format?.tags?.CREATION_TIME ??
    video?.tags?.creation_time ??
    null;
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    hasVideo: Boolean(video),
    creationTime: typeof creationTime === 'string' && creationTime.length ? creationTime : null,
    codec: video?.codec_name ?? null,
    width: Number(video?.width) || null,
    height: Number(video?.height) || null,
  };
}

export function assertCompleteMedia(probe) {
  if (!probe?.hasVideo) throw new Error('INCOMPLETE_MEDIA:no video stream');
  if (!(probe.duration > 0)) throw new Error('INCOMPLETE_MEDIA:duration');
  return probe;
}

export function probeRtsp(url, timeoutMs = 8_000) {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-rtsp_transport',
      'tcp',
      '-stimeout',
      '5000000',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      url,
    ]);
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ live: false });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ live: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ live: false });
        return;
      }
      try {
        const duration = Number(JSON.parse(stdout)?.format?.duration);
        resolve({ live: true, duration: Number.isFinite(duration) ? duration : 0 });
      } catch {
        resolve({ live: false });
      }
    });
  });
}
