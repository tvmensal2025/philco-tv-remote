import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const restaurantId = 'dbd3c84b-aa9d-40df-8245-259d27a83292';
const [
  { data: moments, error: momentsError },
  { data: cameras },
  { data: recordings },
  { data: reels },
] = await Promise.all([
  sb
    .from('moments')
    .select('id,occurred_at,window_start,window_end,label,category,restaurant_id')
    .eq('restaurant_id', restaurantId)
    .order('occurred_at', { ascending: false })
    .limit(20),
  sb.from('cameras').select('id,position,role,name').eq('restaurant_id', restaurantId),
  sb
    .from('recordings')
    .select('id,camera_id,object_key,started_at,ended_at,duration_seconds')
    .eq('restaurant_id', restaurantId)
    .order('started_at', { ascending: false })
    .limit(40),
  sb
    .from('reels')
    .select('id,title,status,moment_id,output_path,created_at,metadata')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(24),
]);

const casa = (reels ?? [])
  .filter((reel) => reel.metadata?.program === 'casa' || /casa/i.test(reel.title ?? ''))
  .slice(0, 10)
  .map((reel) => ({
    id: reel.id,
    title: reel.title,
    status: reel.status,
    moment_id: reel.moment_id,
    output_path: reel.output_path,
    director: reel.metadata?.director_used ?? null,
    timeline: reel.metadata?.timeline_source ?? null,
    renderer: reel.metadata?.composition_renderer_used ?? null,
    vision: reel.metadata?.vision_real ?? null,
    quality: reel.metadata?.quality_status ?? null,
    yoloMs: reel.metadata?.timings?.yoloMs ?? null,
    scenes: (reel.metadata?.scenes ?? []).map((scene) => ({
      cam: scene.cam,
      role: scene.role,
      crop: scene.crop ?? null,
      offset: scene.offset,
      duration: scene.duration,
      desc: String(scene.desc ?? '').slice(0, 90),
    })),
  }));

const report = {
  supabase: env.NEXT_PUBLIC_SUPABASE_URL,
  momentsError: momentsError?.message ?? null,
  cameras,
  recordings,
  moments,
  casa,
};
mkdirSync('work/quality', { recursive: true });
writeFileSync('work/quality/material.json', JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      cameras: (cameras ?? []).map((row) => ({ position: row.position, role: row.role })),
      recordings: (recordings ?? []).length,
      moments: (moments ?? []).length,
      casa: casa.map((row) => ({
        id: row.id,
        status: row.status,
        director: row.director,
        timeline: row.timeline,
        renderer: row.renderer,
        yoloMs: row.yoloMs,
        scenes: row.scenes.length,
      })),
    },
    null,
    2,
  ),
);
