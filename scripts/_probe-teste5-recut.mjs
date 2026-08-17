import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
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
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const env = loadEnv();
const reelId = process.argv[2] || '188e4458-717e-4507-aeb2-8e1a3a83d5ff';
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await sb.from('reels').select('metadata').eq('id', reelId).single();
if (error) throw error;
const m = data.metadata ?? {};
const dir = path.resolve('work/validation/teste5-casa');
const frames = [];
for (const name of [
  't-0p4.jpg',
  't-2.jpg',
  't-5.jpg',
  't-8.jpg',
  't-11.jpg',
  't-14.jpg',
  't-16p5.jpg',
  't-19p866667000000003.jpg',
]) {
  const jpg = path.join(dir, name);
  if (!existsSync(jpg)) continue;
  const probe = await run('ffmpeg', ['-i', jpg, '-vf', 'signalstats', '-f', 'null', '-']);
  const y = probe.stderr.match(/YAVG:([\d.]+)/)?.[1];
  frames.push({ name, yavg: y ? Number(y) : null });
}

console.log(
  JSON.stringify(
    {
      crops: (m.scenes ?? []).map((s) => ({
        cam: s.cam,
        offset: s.offset,
        dur: s.duration,
        transition: s.transition,
        crop: s.crop,
        cropMode: s.cropMode,
        cropTight: s.cropTight,
        punchIn: s.punchIn,
        motion: s.motion,
      })),
      profile: m.render_profile_used,
      renderer: m.composition_renderer_used,
      join: m.join,
      frames,
    },
    null,
    2,
  ),
);
