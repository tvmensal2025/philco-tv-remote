import { NextResponse } from 'next/server';
import {
  cloneValidatedSpec,
  editProgramLabels,
  editPrograms,
  programPresetSpecSchema,
  renderEffectCatalog,
  type EditProgram,
  type ProgramPresetSpec,
} from '@reelops/shared';
import { adminClient } from '@/lib/supabase';
import { assertPlatformWrite, requirePlatformAdmin, writeAdminAudit } from '@/lib/platform-admin';
import { adminError } from '@/lib/admin-error';
import { enforceRateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const saveSchema = z.object({
  program: z.enum(editPrograms),
  spec: programPresetSpecSchema,
});

type PresetRow = {
  id: string;
  program: EditProgram;
  version: number;
  status: 'draft' | 'published' | 'archived';
  spec: ProgramPresetSpec;
  published_at: string | null;
};

async function loadLive(program: EditProgram) {
  const db = adminClient();
  const { data, error } = await db
    .from('platform_program_presets')
    .select('id,program,version,status,spec,published_at')
    .eq('program', program)
    .in('status', ['draft', 'published']);
  if (error) {
    if (/does not exist|schema cache|platform_program_presets/i.test(error.message)) {
      return { draft: null, published: null };
    }
    throw error;
  }
  const rows = (data ?? []) as PresetRow[];
  return {
    draft: rows.find((row) => row.status === 'draft') ?? null,
    published: rows.find((row) => row.status === 'published') ?? null,
  };
}

export async function GET() {
  try {
    await requirePlatformAdmin();
    const programs = await Promise.all(
      editPrograms.map(async (program) => {
        const live = await loadLive(program);
        const validated = cloneValidatedSpec(program);
        const published = live.published
          ? programPresetSpecSchema.safeParse(live.published.spec)
          : null;
        const draft = live.draft ? programPresetSpecSchema.safeParse(live.draft.spec) : null;
        return {
          program,
          label: editProgramLabels[program],
          validated,
          published: published?.success
            ? {
                version: live.published!.version,
                spec: published.data,
                publishedAt: live.published!.published_at,
              }
            : null,
          draft: draft?.success ? { version: live.draft!.version, spec: draft.data } : null,
        };
      }),
    );
    return NextResponse.json({ catalog: renderEffectCatalog, programs });
  } catch (error) {
    return adminError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requirePlatformAdmin();
    assertPlatformWrite(admin.role);
    await enforceRateLimit(`admin-studio:${admin.user.id}`, 30, 60);
    const input = saveSchema.parse(await request.json());
    if (input.spec.program !== input.program)
      throw new Error('O spec precisa ser do mesmo programa.');
    const db = adminClient();
    const live = await loadLive(input.program);
    if (live.draft) {
      const { error } = await db
        .from('platform_program_presets')
        .update({ spec: input.spec, name: 'Rascunho' })
        .eq('id', live.draft.id);
      if (error) throw error;
    } else {
      const { data: latest } = await db
        .from('platform_program_presets')
        .select('version')
        .eq('program', input.program)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const version = Number(latest?.version ?? 0) + 1;
      const { error } = await db.from('platform_program_presets').insert({
        program: input.program,
        version,
        status: 'draft',
        name: 'Rascunho',
        spec: input.spec,
        created_by: admin.user.id,
      });
      if (error) throw error;
    }
    await writeAdminAudit({
      actorUserId: admin.user.id,
      action: 'studio.draft',
      payload: { program: input.program },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminError(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requirePlatformAdmin();
    assertPlatformWrite(admin.role);
    await enforceRateLimit(`admin-studio-publish:${admin.user.id}`, 10, 60);
    const body = z
      .object({
        program: z.enum(editPrograms),
        spec: programPresetSpecSchema.optional(),
      })
      .parse(await request.json());
    const live = await loadLive(body.program);
    const spec = programPresetSpecSchema.parse(
      body.spec ?? live.draft?.spec ?? live.published?.spec ?? cloneValidatedSpec(body.program),
    );
    if (spec.program !== body.program) throw new Error('O spec precisa ser do mesmo programa.');
    const db = adminClient();
    if (live.published) {
      const { error } = await db
        .from('platform_program_presets')
        .update({ status: 'archived' })
        .eq('id', live.published.id);
      if (error) throw error;
    }
    if (live.draft) {
      const { error } = await db
        .from('platform_program_presets')
        .update({
          status: 'published',
          spec,
          name: 'Padrão publicado',
          published_at: new Date().toISOString(),
          created_by: admin.user.id,
        })
        .eq('id', live.draft.id);
      if (error) throw error;
    } else {
      const { data: latest } = await db
        .from('platform_program_presets')
        .select('version')
        .eq('program', body.program)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const version = Number(latest?.version ?? 0) + 1;
      const { error } = await db.from('platform_program_presets').insert({
        program: body.program,
        version,
        status: 'published',
        name: 'Padrão publicado',
        spec,
        created_by: admin.user.id,
        published_at: new Date().toISOString(),
      });
      if (error) throw error;
    }
    await writeAdminAudit({
      actorUserId: admin.user.id,
      action: 'studio.publish',
      payload: { program: body.program },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminError(error);
  }
}
