import { mkdir } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  cameraStoragePrefix,
  cameraUpdateSchema,
  ingestModeOf,
  isMaskedRtspSecret,
  parseRtspUrl,
  sourceTypeForMode,
} from '@reelops/shared';
import { saveCameraPassword } from '@/lib/camera-rtsp';
import { adminClient, requireContext, requireRole } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { cameraInboxPath } from '@/lib/camera-inbox';
import { CAMERA_PLACES, cameraRoleLabel, roleForPlace, slugPlace } from '@/lib/camera-roles';

const createSchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().trim().min(2).max(80).optional(),
  place: z.string().min(2).max(40).optional(),
});

const deleteSchema = z.object({
  cameraId: z.string().uuid(),
});

function readPlace(body: Record<string, unknown>) {
  return typeof body.place === 'string' ? body.place.trim() : undefined;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin']);
    await enforceRateLimit(`cameras-create:${ctx.tenantId}`, 20, 60);
    const body = (await request.json()) as Record<string, unknown>;
    const input = createSchema.parse(body);
    const admin = adminClient();
    const { data: restaurant } = await admin
      .from('restaurants')
      .select('id')
      .eq('id', input.restaurantId)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (!restaurant)
      return NextResponse.json({ error: 'Restaurante não encontrado.' }, { status: 404 });
    const { data: existing } = await admin
      .from('cameras')
      .select('position')
      .eq('tenant_id', ctx.tenantId)
      .eq('restaurant_id', input.restaurantId);
    const taken = new Set((existing ?? []).map((row) => Number(row.position)));
    const position = Array.from({ length: 16 }, (_, index) => index + 1).find(
      (slot) => !taken.has(slot),
    );
    if (!position)
      return NextResponse.json(
        { error: 'Limite de 16 câmeras neste estabelecimento.' },
        { status: 409 },
      );
    const place = input.place ?? (position <= 4 ? CAMERA_PLACES[position - 1].place : 'sala');
    const role = roleForPlace(place);
    const name = input.name ?? `C${position} ${cameraRoleLabel(role, position, place)}`;
    const row = {
      tenant_id: ctx.tenantId,
      restaurant_id: input.restaurantId,
      name,
      position,
      enabled: true,
      storage_prefix: cameraStoragePrefix(ctx.tenantId, input.restaurantId, position),
      source_config: { role, place },
    };
    let { data: camera, error } = await admin
      .from('cameras')
      .insert({ ...row, role })
      .select('id,position,name')
      .single();
    if (error && /role/i.test(error.message)) {
      const retry = await admin.from('cameras').insert(row).select('id,position,name').single();
      camera = retry.data;
      error = retry.error;
    }
    if (error) throw error;
    await mkdir(cameraInboxPath(position), { recursive: true });
    return NextResponse.json({ ok: true, camera });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      {
        error: message === 'FORBIDDEN' ? 'Apenas administradores podem incluir câmeras.' : message,
      },
      { status: message === 'FORBIDDEN' ? 403 : 400 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin']);
    const body = (await request.json()) as Record<string, unknown>;
    const input = cameraUpdateSchema.parse(body);
    const place = readPlace(body);
    const placeLabel =
      'placeLabel' in body
        ? typeof body.placeLabel === 'string'
          ? body.placeLabel.trim().slice(0, 40)
          : ''
        : undefined;
    const role =
      place && place !== 'custom'
        ? roleForPlace(place)
        : typeof body.role === 'string'
          ? body.role
          : input.role;
    const { data: camera } = await ctx.supabase
      .from('cameras')
      .select('id,tenant_id,restaurant_id,position,source_config,source_type')
      .eq('id', input.cameraId)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (!camera) return NextResponse.json({ error: 'Câmera não encontrada.' }, { status: 404 });
    const canonicalPrefix = cameraStoragePrefix(
      ctx.tenantId,
      camera.restaurant_id,
      camera.position,
    );
    if (input.storagePrefix && input.storagePrefix !== canonicalPrefix) {
      return NextResponse.json({ error: 'Caminho de armazenamento inválido.' }, { status: 409 });
    }
    const previousConfig =
      camera.source_config && typeof camera.source_config === 'object'
        ? (camera.source_config as Record<string, unknown>)
        : {};
    const ingestMode =
      input.ingestMode ??
      ingestModeOf(
        input.sourceType ?? (typeof camera.source_type === 'string' ? camera.source_type : null),
        previousConfig,
      );
    const parsedPaste = parseRtspUrl(input.rtspUrl);
    const host = String(
      input.rtspHost || parsedPaste?.host || previousConfig.rtspHost || '',
    ).trim();
    const username = String(
      input.rtspUsername || parsedPaste?.username || previousConfig.rtspUsername || 'admin',
    );
    const passwordInput = input.rtspPassword || parsedPaste?.password || '';
    if (ingestMode === 'rtsp' && !host) {
      return NextResponse.json(
        { error: 'Informe o IP do gravador ou da câmera. A Sofia também pode achar na Wi-Fi.' },
        { status: 400 },
      );
    }
    const sourceConfig: Record<string, unknown> = {
      ...previousConfig,
      ...(role ? { role } : {}),
      ...(place ? { place: place === 'custom' && placeLabel ? slugPlace(placeLabel) : place } : {}),
      ...(placeLabel !== undefined ? { placeLabel: placeLabel || null } : {}),
      ingestMode,
    };
    delete sourceConfig.rtspUrl;
    delete sourceConfig.rtspPassword;
    if (ingestMode === 'rtsp') {
      sourceConfig.rtspHost = host;
      sourceConfig.rtspPort = String(
        input.rtspPort || parsedPaste?.port || previousConfig.rtspPort || '554',
      );
      sourceConfig.rtspUsername = username;
      sourceConfig.rtspBrand = input.rtspBrand || previousConfig.rtspBrand || 'intelbras';
      sourceConfig.rtspChannel = input.rtspChannel || camera.position;
      sourceConfig.rtspTransport = input.rtspTransport === 'udp' ? 'udp' : 'tcp';
      sourceConfig.rtspHasPassword =
        Boolean(previousConfig.rtspHasPassword) || Boolean(passwordInput);
    }
    if (input.folderPath !== undefined) sourceConfig.folderPath = input.folderPath;
    const patch: Record<string, unknown> = {
      name: input.name,
      enabled: input.enabled,
      storage_prefix: canonicalPrefix,
      source_type: sourceTypeForMode(
        ingestMode,
        typeof camera.source_type === 'string' ? camera.source_type : null,
      ),
      source_config: sourceConfig,
    };
    if (role) patch.role = role;
    let { error } = await adminClient()
      .from('cameras')
      .update(patch)
      .eq('id', input.cameraId)
      .eq('tenant_id', ctx.tenantId);
    if (error && /role/i.test(error.message)) {
      delete patch.role;
      ({ error } = await adminClient()
        .from('cameras')
        .update(patch)
        .eq('id', input.cameraId)
        .eq('tenant_id', ctx.tenantId));
    }
    if (error) throw error;
    if (passwordInput && !isMaskedRtspSecret(passwordInput)) {
      await saveCameraPassword(input.cameraId, ctx.tenantId, passwordInput);
    } else if (parsedPaste?.password && !isMaskedRtspSecret(parsedPaste.password)) {
      await saveCameraPassword(input.cameraId, ctx.tenantId, parsedPaste.password);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      {
        error:
          message === 'FORBIDDEN' ? 'Apenas administradores podem configurar câmeras.' : message,
      },
      { status: message === 'FORBIDDEN' ? 403 : 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin']);
    const input = deleteSchema.parse(await request.json());
    const admin = adminClient();
    const { data: camera } = await admin
      .from('cameras')
      .select('id,position,restaurant_id')
      .eq('id', input.cameraId)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (!camera) return NextResponse.json({ error: 'Câmera não encontrada.' }, { status: 404 });
    const { count } = await admin
      .from('cameras')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .eq('restaurant_id', camera.restaurant_id)
      .eq('enabled', true);
    if ((count ?? 0) <= 1)
      return NextResponse.json({ error: 'Deixe pelo menos uma câmera na sala.' }, { status: 409 });
    const { error } = await admin
      .from('cameras')
      .delete()
      .eq('id', camera.id)
      .eq('tenant_id', ctx.tenantId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message === 'FORBIDDEN' ? 'Apenas administradores podem tirar câmeras.' : message },
      { status: message === 'FORBIDDEN' ? 403 : 400 },
    );
  }
}
