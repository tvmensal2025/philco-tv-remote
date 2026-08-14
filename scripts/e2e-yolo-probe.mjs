import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => {
      out += c;
    });
    child.stderr.on('data', (c) => {
      err += c;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

function rewriteLocal(url) {
  return url.replace(/:\/\/(?:yolo|cenapronta_yolo|cenapronta-yolo)(?=[:/?]|$)/i, '://127.0.0.1');
}

const env = loadEnv();
const enabled = ['true', '1', 'yes'].includes(
  String(env.ENABLE_YOLO ?? '')
    .trim()
    .toLowerCase(),
);
const rawUrl = env.YOLO_URL || '';
const urls = [
  ...new Set(
    [rawUrl, rewriteLocal(rawUrl), 'http://127.0.0.1:8000'].filter((u) => /^https?:\/\//i.test(u)),
  ),
];
const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
const report = {
  ENABLE_YOLO: enabled,
  YOLO_URL_configured: Boolean(rawUrl),
  YOLO_URL_host: rawUrl
    ? (() => {
        try {
          return new URL(rawUrl).host;
        } catch {
          return 'invalid';
        }
      })()
    : null,
  tried: [],
  health: null,
  detect: null,
  analyze_frame: null,
};

mkdirSync('work/validation', { recursive: true });
const frame = path.resolve('work/validation/yolo-frame.jpg');
const source = path.resolve('test-assets/e2e/cam-03.mp4');
const extracted = await run(ffmpeg, [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-ss',
  '2',
  '-i',
  source,
  '-frames:v',
  '1',
  '-q:v',
  '3',
  frame,
]);
report.frameExtract = { code: extracted.code, err: extracted.err.slice(-200) };

let liveBase = null;
for (const base of urls) {
  const started = Date.now();
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json();
    report.tried.push({
      host: new URL(base).host,
      status: res.status,
      ms: Date.now() - started,
      body,
    });
    if (res.ok) {
      liveBase = base.replace(/\/$/, '');
      report.health = body;
      break;
    }
  } catch (error) {
    report.tried.push({
      host: new URL(base).host,
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    });
  }
}

if (liveBase && extracted.code === 0) {
  const bytes = readFileSync(frame);
  const image_base64 = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const headers = { 'content-type': 'application/json' };
  if (env.YOLO_API_KEY) headers.authorization = `Bearer ${env.YOLO_API_KEY}`;
  const detectStarted = Date.now();
  try {
    const res = await fetch(`${liveBase}/detect`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image_base64, confidence: 0.35 }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json();
    report.detect = {
      status: res.status,
      http_ms: Date.now() - detectStarted,
      success: body.success === true,
      classes: [...new Set((body.detections ?? []).map((d) => d.class_name))],
      count: (body.detections ?? []).length,
      sample: (body.detections ?? []).slice(0, 8).map((d) => ({
        class_name: d.class_name,
        confidence: d.confidence,
        bbox: d.bbox,
        track_id: d.track_id ?? null,
      })),
    };
  } catch (error) {
    report.detect = {
      error: error instanceof Error ? error.message : String(error),
      http_ms: Date.now() - detectStarted,
    };
  }
  const analyzeStarted = Date.now();
  try {
    const res = await fetch(`${liveBase}/analyze-frame`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image_base64,
        aspect_ratio: '9:16',
        mode: 'plate',
        include_pose: true,
        include_face: true,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json();
    report.analyze_frame = {
      status: res.status,
      http_ms: Date.now() - analyzeStarted,
      success: body.success === true,
      inference_time_ms: body.inference_time_ms ?? null,
      frame: body.frame ?? null,
      people: (body.people ?? []).length,
      faces: (body.faces ?? []).length,
      plates: body.plates ?? [],
      food: (body.food ?? []).map((f) => f.class_name),
      crop: body.crop ?? null,
      suggested_shot: body.suggested_shot ?? null,
      has_person: body.has_person,
      has_plate_scene: body.has_plate_scene,
    };
  } catch (error) {
    report.analyze_frame = {
      error: error instanceof Error ? error.message : String(error),
      http_ms: Date.now() - analyzeStarted,
    };
  }
}

writeFileSync('work/validation/yolo-probe.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.health) process.exit(3);
if (report.detect && report.detect.success !== true && !report.analyze_frame?.success)
  process.exit(2);
