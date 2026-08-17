import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

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
const now = Date.now();
const { data: nodes, error } = await sb
  .from('worker_nodes')
  .select('id,last_seen_at,metadata')
  .order('last_seen_at', { ascending: false })
  .limit(12);
if (error) throw error;

const rows = (nodes ?? []).map((node) => {
  const m = node.metadata ?? {};
  const ageMs = now - Date.parse(node.last_seen_at);
  return {
    id: node.id,
    hostname: m.hostname ?? null,
    ageMs,
    live: ageMs < 90_000,
    startedAt: m.startedAt ?? null,
    releaseStamp: m.releaseStamp ?? null,
    gitSha: m.gitSha ?? null,
    version: m.version ?? null,
    pipelineVersion: m.pipelineVersion ?? null,
    vision_real: m.vision_real ?? null,
    visionModel: m.visionModel ?? null,
    last_seen_at: node.last_seen_at,
  };
});

const live = rows.filter((row) => row.live);
const vps = live.filter((row) => !/rafael/i.test(String(row.hostname ?? row.id)));
const rafael = live.filter((row) => /rafael/i.test(String(row.hostname ?? row.id)));
const stampOk = vps.length === 1 && vps[0]?.releaseStamp === 'editorial-p1';
const started = vps[0]?.startedAt ? Date.parse(vps[0].startedAt) : 0;
const startedAfterPush = started > Date.parse('2026-08-16T10:55:00Z');

const { data: baseline } = await sb
  .from('reels')
  .select('id,status,duration_seconds,caption,created_at,updated_at,metadata')
  .eq('id', 'e6a23108-e3a0-43c7-bafd-af1085b2c082')
  .single();
const bm = baseline?.metadata ?? {};

console.log(
  JSON.stringify(
    {
      expectedCommit: 'fde6bb4f3ef2a586e60431163d648d10e7075b54',
      liveCount: live.length,
      vpsCount: vps.length,
      rafaelLive: rafael.length,
      stampOk,
      startedAfterPush,
      gate: live.length === 1 && vps.length === 1 && stampOk && startedAfterPush,
      live,
      stale: rows.filter((row) => !row.live).slice(0, 4),
      baseline: {
        id: baseline?.id,
        status: baseline?.status,
        duration: baseline?.duration_seconds,
        caption: baseline?.caption,
        created_at: baseline?.created_at,
        release_stamp: bm.release_stamp ?? null,
        takeJudgeMs: bm.timings?.takeJudgeMs ?? null,
        director_used: bm.director_used ?? null,
        join: bm.join ?? null,
        title: bm.video_edit_decision?.text?.title ?? bm.house_cut?.[0]?.title ?? null,
        scenes: (bm.scenes ?? []).map((s) => ({
          cam: s.cam,
          offset: s.offset,
          duration: s.duration,
          cropMode: s.cropMode,
          transition: s.transition,
        })),
        house_cut: (bm.house_cut ?? []).map((t) => ({
          duration: t.duration,
          offset: t.source_start_offset ?? t.offset,
          cropMode: t.cropMode,
          transition: t.transition,
        })),
      },
    },
    null,
    2,
  ),
);
