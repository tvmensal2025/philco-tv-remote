import { readFileSync } from 'node:fs';

const keys = [
  'FFMPEG_PATH',
  'FFPROBE_PATH',
  'REQUIRE_REVIDEO_RENDER',
  'REQUIRE_AI_DIRECTOR',
  'ENABLE_REVIDEO',
  'ENABLE_AI_DIRECTOR',
  'PUPPETEER_CACHE_DIR',
  'ENABLE_YOLO',
  'YOLO_URL',
  'YOLO_TIMEOUT_MS',
  'ENABLE_TRACKING',
  'ENABLE_SMART_REFRAME',
  'ENABLE_MULTICAMERA_RANKER',
  'ENABLE_BEAT_EDITING',
  'ENABLE_VISUAL_QC',
  'ENABLE_TRACKING_QC',
  'ENABLE_AUTO_REPAIR',
  'ENABLE_ELEVENLABS',
  'REQUIRE_REAL_VISION',
  'VISION_PROVIDER',
  'REDIS_URL',
];
const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}
for (const key of keys) {
  const value = env[key];
  if (value === undefined) {
    console.log(`${key}=MISSING`);
    continue;
  }
  if (key === 'REDIS_URL' || key === 'YOLO_URL') {
    try {
      const url = new URL(value);
      console.log(
        `${key}=${url.protocol}//${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`,
      );
    } catch {
      console.log(`${key}=INVALID`);
    }
    continue;
  }
  console.log(`${key}=${value}`);
}
