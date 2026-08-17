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

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data } = await sb
  .from('reels')
  .select('metadata')
  .eq('id', 'b3041836-2974-4b4e-96ba-0eb7e77b99b8')
  .single();
const m = data.metadata;
const scenes = m.scenes ?? [];
console.log(
  JSON.stringify(
    {
      sceneCount: Array.isArray(scenes) ? scenes.length : typeof scenes,
      scenes: Array.isArray(scenes)
        ? scenes.map((s) => ({
            start: s.source_start_offset ?? s.sourceStartSeconds ?? s.sourceStartMs,
            duration: s.duration ?? s.durationSeconds,
            crop: s.crop,
            cropMode: s.cropMode,
            cropFilter: s.cropFilter,
            cropTight: s.cropTight,
            transition: s.transition,
            fadeIn: s.fadeIn,
            fadeOut: s.fadeOut,
            punchIn: s.punchIn,
            motion: s.motion,
            shotStyle: s.shotStyle,
            position: s.position,
          }))
        : scenes,
      audio: m.video_edit_decision?.audio,
    },
    null,
    2,
  ),
);

const probe = spawn('ffprobe', [
  '-v',
  'error',
  '-show_entries',
  'format=start_time,duration:stream=start_time,codec_type,duration',
  '-of',
  'json',
  'D:\\DEV\\TESTE5.mp4',
]);
let out = '';
probe.stdout.on('data', (c) => (out += c));
await new Promise((resolve) => probe.on('close', resolve));
console.log('sourceStart', out);
