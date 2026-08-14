import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  parseVideoEditDecision,
  repairVideoEditDecision,
} from '../packages/shared/src/video-decision.ts';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const { reelIds } = JSON.parse(readFileSync('test-assets/e2e/core-stabilize.json', 'utf8'));
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: reels, error } = await sb
    .from('reels')
    .select('id,title,metadata,moment_id,tenant_id,restaurant_id')
    .in('id', reelIds);
  if (error) throw error;
  const casa = (reels ?? []).find((reel) => reel.metadata?.program === 'casa') ?? reels?.[0];
  if (!casa) throw new Error('no casa reel');
  const meta = casa.metadata ?? {};
  const legacy = meta.video_edit_decision;
  const playbook =
    'CASA = ambiente e experiência da sala. Preferir câmeras de ambiência/master. Ritmo médio. Poucos cortes.';
  const started = Date.now();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || 'gpt-4.1-mini',
      temperature: 0.2,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You return only VideoEditDecisionV1 JSON. schemaVersion=1.0 scoreScale=0-100. sourceStartMs/sourceEndMs are milliseconds relative to the recording start, never Unix time. Scores are integers 0-100. Enums only. Do not invent prices, discounts, ingredients, awards, dates. Neutral title if unsure. Do not emit markdown.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            playbook,
            program: 'casa',
            vision: {
              provider: meta.provider,
              model: meta.model,
              reason: meta.analysis,
              detailedScores: meta.detailedScores,
              cameraRankings: meta.camera_rankings,
              bestFrames: meta.best_frames,
            },
            candidateScenes: meta.scenes ?? [],
            legacyDecision: legacy,
            ids: {
              tenantId: casa.tenant_id,
              restaurantId: casa.restaurant_id,
              momentId: casa.moment_id,
              reelId: casa.id,
            },
          }),
        },
      ],
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? `openai ${response.status}`);
  const raw = JSON.parse(payload.choices?.[0]?.message?.content ?? '{}');
  let parsed = parseVideoEditDecision({
    ...legacy,
    ...raw,
    schemaVersion: '1.0',
    scoreScale: '0-100',
    tenantId: casa.tenant_id,
    restaurantId: casa.restaurant_id,
    momentId: casa.moment_id,
    reelId: casa.id,
    program: 'casa',
  });
  if (!parsed.success)
    parsed = repairVideoEditDecision({
      ...legacy,
      ...raw,
      schemaVersion: '1.0',
      scoreScale: '0-100',
      tenantId: casa.tenant_id,
      restaurantId: casa.restaurant_id,
      momentId: casa.moment_id,
      reelId: casa.id,
      program: 'casa',
    });
  if (!parsed.success) {
    writeFileSync(
      'work/revideo-evidence/director-raw.json',
      JSON.stringify(
        {
          raw,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
            code: issue.code,
          })),
        },
        null,
        2,
      ),
    );
    throw new Error('DIRECTOR_INVALID_OUTPUT');
  }
  const decision = parsed.data;
  const compare = {
    provider: 'openai',
    model: env.OPENAI_MODEL || 'gpt-4.1-mini',
    latency_ms: Date.now() - started,
    prompt_tokens: payload.usage?.prompt_tokens,
    completion_tokens: payload.usage?.completion_tokens,
    heuristic: false,
    momentId: casa.moment_id,
    reelId: casa.id,
    legacy: {
      scenes: legacy?.scenes?.length ?? 0,
      durationTargetMs: legacy?.durationTargetMs ?? null,
      pace: legacy?.story?.pace ?? null,
      hook: legacy?.scenes?.[0]?.role ?? null,
      cameras: (legacy?.scenes ?? []).map((scene) => scene.cameraId),
    },
    ai: {
      scenes: decision.scenes.length,
      durationTargetMs: decision.durationTargetMs,
      pace: decision.story.pace,
      hook: decision.scenes[0]?.role ?? null,
      cameras: decision.scenes.map((scene) => scene.cameraId),
      title: decision.text.title,
      storyType: decision.story.type,
    },
    decision: {
      schemaVersion: decision.schemaVersion,
      program: decision.program,
      durationTargetMs: decision.durationTargetMs,
      sceneCount: decision.scenes.length,
      roles: decision.scenes.map((scene) => scene.role),
      motions: decision.scenes.map((scene) => scene.motion),
      audioStrategy: decision.audio.strategy,
      title: decision.text.title,
    },
  };
  mkdirSync('work/revideo-evidence', { recursive: true });
  writeFileSync('work/revideo-evidence/director-compare.json', JSON.stringify(compare, null, 2));
  await sb
    .from('reels')
    .update({
      metadata: {
        ...meta,
        ai_director_decision: decision,
        ai_director_provider: 'openai',
        ai_director_model: compare.model,
        ai_director_latency_ms: compare.latency_ms,
      },
    })
    .eq('id', casa.id)
    .eq('tenant_id', casa.tenant_id);
  console.log(JSON.stringify(compare, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
