import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminClient, requireContext, requireRole } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';

const startSchema = z.object({
  action: z.enum(['start', 'confirm', 'folder', 'cancel']),
  restaurantId: z.string().uuid(),
  deviceId: z.string().trim().max(120).optional(),
  username: z.string().trim().max(80).optional(),
  password: z.string().max(200).optional(),
  mode: z.enum(['rtsp', 'folder']).optional(),
  folderPath: z.string().trim().max(400).optional(),
  channels: z.array(z.number().int().min(1).max(16)).max(16).optional(),
});

async function loadSession(tenantId: string, restaurantId: string) {
  const admin = adminClient();
  const { data } = await admin
    .from('sofia_sessions')
    .select('id,status,discoveries,selection,agent_seen_at,last_error,updated_at')
    .eq('tenant_id', tenantId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  return data;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireContext();
    const restaurantId = new URL(request.url).searchParams.get('restaurantId');
    if (!restaurantId)
      return NextResponse.json({ error: 'Restaurante inválido.' }, { status: 400 });
    const session = await loadSession(ctx.tenantId, restaurantId);
    const agentLive =
      Boolean(session?.agent_seen_at) &&
      Date.now() - Date.parse(String(session.agent_seen_at)) < 20_000;
    return NextResponse.json({
      session: session
        ? {
            status: session.status,
            discoveries: session.discoveries ?? [],
            selection: session.selection ?? {},
            lastError: session.last_error,
            agentLive,
            updatedAt: session.updated_at,
          }
        : null,
    });
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
    requireRole(ctx.role, ['owner', 'admin']);
    const input = startSchema.parse(await request.json());
    await enforceRateLimit(`sofia:${ctx.tenantId}`, 30, 60);
    const admin = adminClient();
    const { data: restaurant } = await admin
      .from('restaurants')
      .select('id')
      .eq('id', input.restaurantId)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (!restaurant)
      return NextResponse.json({ error: 'Restaurante não encontrado.' }, { status: 404 });

    if (input.action === 'cancel') {
      await admin.from('sofia_secrets').delete().eq('restaurant_id', input.restaurantId);
      await admin.from('sofia_sessions').upsert(
        {
          tenant_id: ctx.tenantId,
          restaurant_id: input.restaurantId,
          status: 'idle',
          discoveries: [],
          selection: {},
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'restaurant_id' },
      );
      return NextResponse.json({ ok: true });
    }

    if (input.action === 'start') {
      await admin.from('sofia_sessions').upsert(
        {
          tenant_id: ctx.tenantId,
          restaurant_id: input.restaurantId,
          status: 'waiting_agent',
          discoveries: [],
          selection: { command: 'scan' },
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'restaurant_id' },
      );
      return NextResponse.json({ ok: true });
    }

    if (input.action === 'folder') {
      const folderPath = input.folderPath?.trim() || 'C:\\CenaPronta\\cameras';
      await admin.from('sofia_sessions').upsert(
        {
          tenant_id: ctx.tenantId,
          restaurant_id: input.restaurantId,
          status: 'configuring',
          selection: { command: 'watch_folder', folderPath, mode: 'folder' },
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'restaurant_id' },
      );
      return NextResponse.json({ ok: true });
    }

    const session = await loadSession(ctx.tenantId, input.restaurantId);
    const discoveries = Array.isArray(session?.discoveries) ? session.discoveries : [];
    const device = discoveries.find((item) => {
      const row = item as { id?: string; ip?: string };
      return row.id === input.deviceId || row.ip === input.deviceId;
    }) as { id?: string; ip?: string; kind?: string; brand?: string; name?: string } | undefined;
    if (!device?.ip) {
      return NextResponse.json(
        { error: 'Escolha o gravador ou a câmera que a Sofia achou.' },
        { status: 400 },
      );
    }
    const channels = input.channels?.length ? input.channels : [1, 2, 3, 4];
    await admin.from('sofia_secrets').upsert({
      restaurant_id: input.restaurantId,
      tenant_id: ctx.tenantId,
      username: input.username?.trim() || 'admin',
      password: input.password ?? '',
      updated_at: new Date().toISOString(),
    });
    await admin.from('sofia_sessions').upsert(
      {
        tenant_id: ctx.tenantId,
        restaurant_id: input.restaurantId,
        status: 'configuring',
        discoveries,
        selection: {
          command: 'configure',
          mode: input.mode ?? 'rtsp',
          deviceId: device.id || device.ip,
          ip: device.ip,
          kind: device.kind,
          brand: device.brand || 'intelbras',
          name: device.name,
          username: input.username?.trim() || 'admin',
          channels,
        },
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'restaurant_id' },
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message === 'FORBIDDEN' ? 'Apenas administradores.' : message },
      { status: message === 'FORBIDDEN' ? 403 : 400 },
    );
  }
}
