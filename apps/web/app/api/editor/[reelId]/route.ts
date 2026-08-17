import { NextResponse } from 'next/server';
import {
  parseVideoProject,
  parseVideoEditDecisionV2,
  projectFromDecision,
  projectFromLegacyScenes,
  createEmptyProject,
  type ProjectSourceTake,
  type VideoProject,
} from '@reelops/shared';
import { requireContext, requireRole } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';

type ReelMeta = {
  program?: string;
  video_project?: unknown;
  video_edit_decision?: unknown;
  scenes?: unknown;
  scene_coherence?: {
    rejected?: Array<{
      camera?: string;
      cameraPosition?: number;
      recordingId?: string;
      reasons?: string[];
    }>;
  } | null;
};

function hydrateProjectMedia(project: VideoProject, takes: ProjectSourceTake[]): VideoProject {
  const byRecording = new Map(takes.map((take) => [take.recordingId, take]));
  const known = new Set(project.media.map((asset) => asset.recordingId).filter(Boolean));
  const media = project.media.map((asset) => {
    const take = asset.recordingId ? byRecording.get(asset.recordingId) : undefined;
    return take ? { ...asset, previewUrl: take.previewUrl, objectPath: take.objectPath } : asset;
  });
  const extras = takes
    .filter((take) => !known.has(take.recordingId))
    .map((take) => ({
      id: `media_${take.recordingId}`,
      kind: 'video' as const,
      name: take.name ?? take.cameraLabel ?? take.recordingId,
      recordingId: take.recordingId,
      cameraId: take.cameraId,
      cameraPosition: take.cameraPosition,
      cameraLabel: take.cameraLabel,
      durationMs: take.durationMs ?? 0,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: take.hasAudio !== false,
      previewUrl: take.previewUrl,
      objectPath: take.objectPath,
      takeStatus: 'available' as const,
      scores: take.scores,
    }));
  if (!extras.length) return { ...project, media };
  return {
    ...project,
    media: [...media, ...extras],
    ai: {
      mode: project.ai?.mode ?? 'balanced',
      decisions: project.ai?.decisions ?? [],
      unusedMediaIds: [...(project.ai?.unusedMediaIds ?? []), ...extras.map((item) => item.id)],
      quality: project.ai?.quality,
      renderFromProject: project.ai?.renderFromProject ?? false,
    },
  };
}

function rejectedFromMeta(
  meta: ReelMeta,
): Array<{ cameraPosition?: number; recordingId?: string; reason?: string }> {
  return (meta.scene_coherence?.rejected ?? []).map((row) => ({
    cameraPosition:
      row.cameraPosition ?? (Number(String(row.camera ?? '').replace(/\D/g, '')) || undefined),
    recordingId: row.recordingId,
    reason: row.reasons?.join(' · ') ?? 'Take rejeitado',
  }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ reelId: string }> }) {
  try {
    const ctx = await requireContext();
    const { reelId } = await params;
    const { data: reel } = await ctx.supabase
      .from('reels')
      .select(
        'id,title,status,restaurant_id,moment_id,metadata,moments(occurred_at,window_start,window_end,label)',
      )
      .eq('id', reelId)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (!reel) return NextResponse.json({ error: 'Reel não encontrado.' }, { status: 404 });

    const meta = (
      reel.metadata && typeof reel.metadata === 'object' ? reel.metadata : {}
    ) as ReelMeta;
    const moment = Array.isArray(reel.moments) ? reel.moments[0] : reel.moments;
    const windowStart = moment?.window_start ?? moment?.occurred_at;
    const windowEnd = moment?.window_end ?? moment?.occurred_at;

    let recordings: Array<{
      id: string;
      object_key: string;
      duration_seconds: number | null;
      camera_id: string;
      cameras: { name: string; position: number } | { name: string; position: number }[] | null;
    }> = [];
    if (reel.restaurant_id && windowStart && windowEnd) {
      const { data } = await ctx.supabase
        .from('recordings')
        .select(
          'id,object_key,duration_seconds,camera_id,started_at,ended_at,cameras(name,position)',
        )
        .eq('tenant_id', ctx.tenantId)
        .eq('restaurant_id', reel.restaurant_id)
        .lte('started_at', windowEnd)
        .gte('ended_at', windowStart)
        .order('started_at', { ascending: false })
        .limit(32);
      recordings = data ?? [];
    }

    const takes: ProjectSourceTake[] = recordings.map((row) => {
      const camera = Array.isArray(row.cameras) ? row.cameras[0] : row.cameras;
      return {
        recordingId: row.id,
        cameraId: row.camera_id,
        cameraPosition: camera?.position ?? 1,
        cameraLabel: camera?.name ?? `C${camera?.position ?? 1}`,
        name: camera?.name ?? row.id,
        durationMs: Math.round((row.duration_seconds ?? 0) * 1000),
        hasAudio: true,
        previewUrl: `/api/recordings/${row.id}/media`,
        objectPath: row.object_key,
      };
    });

    let project: VideoProject | null = null;
    const saved = parseVideoProject(meta.video_project);
    if (saved.success) {
      project = hydrateProjectMedia(saved.data, takes);
    } else {
      const decision = parseVideoEditDecisionV2(meta.video_edit_decision);
      if (decision.success) {
        project = hydrateProjectMedia(
          projectFromDecision({
            decision: decision.data,
            takes,
            name: reel.title ?? undefined,
            rejected: rejectedFromMeta(meta),
          }),
          takes,
        );
      } else if (Array.isArray(meta.scenes) && meta.scenes.length) {
        project = hydrateProjectMedia(
          projectFromLegacyScenes({
            reelId: reel.id,
            program:
              meta.program === 'oficio' ||
              meta.program === 'assinatura' ||
              meta.program === 'pulso' ||
              meta.program === 'casa'
                ? meta.program
                : undefined,
            name: reel.title ?? undefined,
            scenes: meta.scenes as Parameters<typeof projectFromLegacyScenes>[0]['scenes'],
            takes,
            rejected: rejectedFromMeta(meta),
          }),
          takes,
        );
      } else {
        project = createEmptyProject({
          name: reel.title ?? 'Projeto',
          reelId: reel.id,
          program:
            meta.program === 'oficio' ||
            meta.program === 'assinatura' ||
            meta.program === 'pulso' ||
            meta.program === 'casa'
              ? meta.program
              : 'casa',
        });
        project.media = takes.map((take) => ({
          id: `media_${take.recordingId}`,
          kind: 'video' as const,
          name: take.name ?? take.cameraLabel ?? take.recordingId,
          recordingId: take.recordingId,
          cameraId: take.cameraId,
          cameraPosition: take.cameraPosition,
          cameraLabel: take.cameraLabel,
          durationMs: take.durationMs ?? 0,
          width: 1920,
          height: 1080,
          fps: 30,
          hasAudio: true,
          previewUrl: take.previewUrl,
          objectPath: take.objectPath,
          takeStatus: 'available' as const,
        }));
        project.ai = {
          mode: 'balanced',
          decisions: [],
          unusedMediaIds: project.media.map((item) => item.id),
          renderFromProject: false,
        };
      }
    }

    return NextResponse.json({
      project,
      reel: {
        id: reel.id,
        title: reel.title,
        status: reel.status,
        program: meta.program ?? project.program,
        restaurantId: reel.restaurant_id,
      },
      takes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message === 'UNAUTHORIZED' ? 'Não autorizado.' : message },
      { status: message === 'UNAUTHORIZED' ? 401 : 400 },
    );
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ reelId: string }> }) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin', 'editor']);
    await enforceRateLimit(`editor-save:${ctx.tenantId}:${ctx.user.id}`, 60, 60);
    const { reelId } = await params;
    const body = await request.json();
    const parsed = parseVideoProject(body.project);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Projeto inválido.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { data: reel } = await ctx.supabase
      .from('reels')
      .select('id,metadata')
      .eq('id', reelId)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (!reel) return NextResponse.json({ error: 'Reel não encontrado.' }, { status: 404 });
    const current =
      reel.metadata && typeof reel.metadata === 'object'
        ? (reel.metadata as Record<string, unknown>)
        : {};
    const project: VideoProject = { ...parsed.data, updatedAt: new Date().toISOString(), reelId };
    const { error } = await ctx.supabase
      .from('reels')
      .update({ metadata: { ...current, video_project: project } })
      .eq('id', reelId)
      .eq('tenant_id', ctx.tenantId);
    if (error) throw error;
    return NextResponse.json({ ok: true, updatedAt: project.updatedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    const status =
      message === 'UNAUTHORIZED'
        ? 401
        : message === 'FORBIDDEN'
          ? 403
          : message === 'RATE_LIMITED'
            ? 429
            : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
