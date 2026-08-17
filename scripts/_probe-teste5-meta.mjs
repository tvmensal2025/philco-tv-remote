import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

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
const v1 = m.video_edit_decision;
const scenes = v1?.scenes ?? v1?.timeline ?? [];
const planScenes = m.render_manifest?.scenes ?? m.video_project?.sequences?.[0]?.tracks?.[0]?.clips;
const crops = (m.house_cut ?? []).map((t, i) => ({
  i,
  duration: t.duration,
  cropMode: t.cropMode,
  transition: t.transition,
}));
const { data: rec } = await sb
  .from('recordings')
  .select('id,duration_seconds,started_at,ended_at,object_key,size_bytes')
  .eq('id', '80d046dc-0591-4bf2-a033-b224d85da96b')
  .single();
const src = await run('ffprobe', [
  '-v',
  'error',
  '-analyzeduration',
  '5M',
  '-probesize',
  '5M',
  '-show_entries',
  'format=duration,size:stream=codec_type,width,height,duration,nb_frames',
  '-of',
  'json',
  'D:\\DEV\\TESTE5.mp4',
]);
const decisionScenes = (v1?.scenes ?? []).map((s) => ({
  role: s.sceneRole,
  startMs: s.sourceStartMs,
  endMs: s.sourceEndMs,
  startSec: (s.sourceStartMs ?? 0) / 1000,
  durSec: ((s.sourceEndMs ?? 0) - (s.sourceStartMs ?? 0)) / 1000,
  transitionOut: s.transitionOut,
  shotStyle: s.shotStyle,
}));
console.log(
  JSON.stringify(
    {
      recording: rec,
      sourceProbe: JSON.parse(src.stdout || '{}'),
      sourceErr: src.stderr.slice(0, 400),
      crops,
      decisionScenes,
      durationTargetMs: v1?.durationTargetMs,
      audioStrategy: v1?.audio?.strategy ?? v1?.audioStrategy,
      branding: v1?.text,
    },
    null,
    2,
  ),
);
