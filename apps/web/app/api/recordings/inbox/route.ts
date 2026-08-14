import { NextResponse } from 'next/server';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { requireContext, requireRole } from '@/lib/supabase';
import { cameraInboxPath, camerasInboxRoot } from '@/lib/camera-inbox';
import { cameraPlaceOf, cameraRoleLabel } from '@/lib/camera-roles';

export const runtime = 'nodejs';

function camerasRoot() {
  return camerasInboxRoot();
}

export async function GET() {
  try {
    const ctx = await requireContext();
    const root = camerasRoot();
    const { data: cameras } = await ctx.supabase
      .from('cameras')
      .select('position,name,source_config,enabled')
      .eq('tenant_id', ctx.tenantId)
      .eq('enabled', true)
      .order('position');
    const folders = [];
    for (const camera of cameras ?? []) {
      const config =
        camera.source_config && typeof camera.source_config === 'object'
          ? (camera.source_config as { role?: string; place?: string })
          : {};
      const folderPath = cameraInboxPath(camera.position);
      await mkdir(folderPath, { recursive: true });
      folders.push({
        position: camera.position,
        folder: `C${camera.position}`,
        label: camera.name || cameraRoleLabel(config.role, camera.position, config.place),
        path: folderPath,
        place: cameraPlaceOf(config.place, config.role, camera.position),
      });
    }
    if (!folders.length) {
      for (const position of [1, 2, 3, 4]) {
        const folderPath = cameraInboxPath(position);
        await mkdir(folderPath, { recursive: true });
        folders.push({
          position,
          folder: `C${position}`,
          label: cameraRoleLabel(undefined, position),
          path: folderPath,
          place: cameraPlaceOf(null, null, position),
        });
      }
    }
    return NextResponse.json({ root, folders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message === 'UNAUTHORIZED' ? 'Não autorizado.' : message },
      { status: message === 'UNAUTHORIZED' ? 401 : 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin', 'editor']);
    const body = (await request.json()) as { position?: number };
    const position = Number(body.position);
    if (!Number.isInteger(position) || position < 1 || position > 16) {
      return NextResponse.json({ error: 'Câmera inválida.' }, { status: 400 });
    }
    const folderPath = cameraInboxPath(position);
    await mkdir(folderPath, { recursive: true });
    spawn('explorer.exe', [folderPath], { detached: true, stdio: 'ignore' }).unref();
    return NextResponse.json({ ok: true, path: folderPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    const status = message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
