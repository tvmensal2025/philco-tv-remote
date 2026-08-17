import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: reel } = await sb
  .from('reels')
  .select('metadata')
  .eq('id', 'b3041836-2974-4b4e-96ba-0eb7e77b99b8')
  .single();
const m = reel.metadata ?? {};
const clips = m.video_project?.sequences?.[0]?.tracks?.find((t) => t.kind === 'video')?.clips ?? [];
const yolo = m.yolo ?? m.timings ?? {};
const crops = (m.video_edit_decision?.scenes ?? []).map((s, i) => ({
  i,
  crop: s.crop ?? s.reframe ?? s.cropBox ?? null,
  cropStrategy: s.cropStrategy ?? s.reframeStrategy,
  sourceStartMs: s.sourceStartMs,
  transitionOut: s.transitionOut,
}));
const dest = path.resolve(
  'C:/Users/plata/.cursor/projects/c-Users-plata-Documents-Codex-philco-tv-remote/agent-tools/teste5-frames',
);
mkdirSync(dest, { recursive: true });
const src = 'D:\\DEV\\TESTE5.mp4';
for (const t of [600, 659.2, 716.9, 776.5, 832.7]) {
  const jpg = path.join(dest, `src-${String(t).replace('.', 'p')}.jpg`);
  await run('ffmpeg', ['-y', '-ss', String(t), '-i', src, '-frames:v', '1', '-q:v', '3', jpg]);
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] != null) out[k] = obj[k];
  return out;
}

console.log(
  JSON.stringify(
    {
      metadataKeys: Object.keys(m).sort(),
      crops,
      clipCrops: clips.map((c) =>
        pick(c, ['id', 'sourceInMs', 'sourceOutMs', 'crop', 'motion', 'transitionIn', 'disabled']),
      ),
      manifestScenes: (m.render_manifest?.scenes ?? []).slice(0, 8),
      yoloKeys: Object.keys(yolo),
    },
    null,
    2,
  ),
);
