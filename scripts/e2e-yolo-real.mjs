import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';

const YOLO_URL = 'https://cenapronta-yolo.d9v63q.easypanel.host';

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    /* optional */
  }
  return env;
}

function normalizeBbox(bbox, frame) {
  if (!bbox || bbox.length !== 4 || !frame?.width || !frame?.height) return null;
  const [x, y, w, h] = bbox;
  return {
    x: Number((x / frame.width).toFixed(4)),
    y: Number((y / frame.height).toFixed(4)),
    w: Number((w / frame.width).toFixed(4)),
    h: Number((h / frame.height).toFixed(4)),
  };
}

function summarize(result) {
  const people = result.people ?? [];
  const plates = result.plates ?? [];
  const food = result.food ?? [];
  const classes = [
    ...people.map(() => 'person'),
    ...plates.map((item) => item.class_name),
    ...food.map((item) => item.class_name),
  ];
  return {
    success: result.success === true,
    inference_ms: result.inference_time_ms ?? null,
    frame: result.frame ?? null,
    classes: [...new Set(classes)],
    people: people.map((person) => ({
      detector_class: 'person',
      track_id: person.track_id ?? null,
      confidence: person.confidence,
      bbox_px: person.bbox,
      bbox_norm: normalizeBbox(person.bbox, result.frame),
    })),
    plates: plates.map((item) => ({
      detector_class: item.class_name,
      confidence: item.confidence,
      bbox_px: item.bbox,
      bbox_norm: normalizeBbox(item.bbox, result.frame),
    })),
    food: food.map((item) => ({
      detector_class: item.class_name,
      confidence: item.confidence,
      bbox_px: item.bbox,
      bbox_norm: normalizeBbox(item.bbox, result.frame),
    })),
    has_person: result.has_person ?? false,
    has_face: result.has_face ?? false,
    has_plate_scene: result.has_plate_scene ?? false,
    suggested_shot: result.suggested_shot ?? null,
    crop: result.crop ?? null,
  };
}

async function analyzeFrame(path, mode) {
  const bytes = readFileSync(path);
  const headers = { 'content-type': 'application/json' };
  const env = loadEnv();
  if (env.YOLO_API_KEY) headers.authorization = `Bearer ${env.YOLO_API_KEY}`;
  const started = Date.now();
  const response = await fetch(`${YOLO_URL}/analyze-frame`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image_base64: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      aspect_ratio: '9:16',
      mode,
      include_pose: true,
      include_face: true,
    }),
  });
  const wallMs = Date.now() - started;
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return {
    file: basename(path),
    mode,
    http_status: response.status,
    wall_ms: wallMs,
    bytes: bytes.length,
    result: response.ok ? summarize(body) : { error: body.detail ?? body },
  };
}

const healthBefore = await (await fetch(`${YOLO_URL}/health`)).json();
const c1 = await analyzeFrame('work/validation/yolo-frames/C1-t35.jpg', 'person');
const c3 = await analyzeFrame('work/validation/yolo-frames/C3-t35.jpg', 'plate');
const healthAfter = await (await fetch(`${YOLO_URL}/health`)).json();

const report = {
  url: YOLO_URL,
  health_before: healthBefore,
  health_after: healthAfter,
  frames: [c1, c3],
  real_model_loaded: Boolean(healthAfter?.models_loaded?.detect),
  real_clip: true,
  detections_real: [c1, c3].some(
    (frame) =>
      frame.http_status === 200 &&
      ((frame.result.people?.length ?? 0) > 0 ||
        (frame.result.food?.length ?? 0) > 0 ||
        (frame.result.plates?.length ?? 0) > 0),
  ),
};
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/yolo-real.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
