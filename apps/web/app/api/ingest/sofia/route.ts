import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';
import { getServerEnv } from '@/lib/env';
import { enforceRateLimit } from '@/lib/rate-limit';
import { saveCameraPassword } from '@/lib/camera-rtsp';
import { sourceTypeForMode } from '@reelops/shared';

async function requireIngest(request: Request) {
  const env = getServerEnv();
  if (request.headers.get('authorization') !== `Bearer ${env.INGEST_API_KEY}`) {
    throw new Error('UNAUTHORIZED');
  }
}

function commandFor(status: string, selection: Record<string, unknown>) {
  if (status === 'waiting_agent' || status === 'scanning') return 'scan';
  if (status === 'configuring' && typeof selection.command === 'string') return selection.command;
  return 'idle';
}

export async function GET(request: Request) {
  try {
    await requireIngest(request);
    const restaurantId = new URL(request.url).searchParams.get('restaurantId');
    if (!restaurantId)
      return NextResponse.json({ error: 'restaurantId obrigatório.' }, { status: 400 });
    await enforceRateLimit(`sofia-agent:${restaurantId}`, 60, 60);
    const admin = adminClient();
    const { data: restaurant } = await admin
      .from('restaurants')
      .select('id,tenant_id')
      .eq('id', restaurantId)
      .single();
    if (!restaurant)
      return NextResponse.json({ error: 'Restaurante não encontrado.' }, { status: 404 });
    const now = new Date().toISOString();
    const { data: session } = await admin
      .from('sofia_sessions')
      .select('status,selection,discoveries')
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    const status = session?.status ?? 'idle';
    if (status === 'waiting_agent') {
      await admin
        .from('sofia_sessions')
        .update({ status: 'scanning', agent_seen_at: now, updated_at: now })
        .eq('restaurant_id', restaurantId);
    } else if (session) {
      await admin
        .from('sofia_sessions')
        .update({ agent_seen_at: now, updated_at: now })
        .eq('restaurant_id', restaurantId);
    }
    const selection = (session?.selection ?? {}) as Record<string, unknown>;
    const command = commandFor(status, selection);
    const publicSelection: Record<string, unknown> = {
      ...selection,
      username: typeof selection.username === 'string' ? selection.username : 'admin',
    };
    if (command === 'configure') {
      const { data: secret } = await admin
        .from('sofia_secrets')
        .select('username,password')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      publicSelection.username = secret?.username || publicSelection.username;
      publicSelection.password = secret?.password || '';
    } else {
      delete publicSelection.password;
    }
    return NextResponse.json({
      command,
      status: status === 'waiting_agent' ? 'scanning' : status,
      selection: publicSelection,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message === 'UNAUTHORIZED' ? 'Chave de ingestão inválida.' : message },
      { status: message === 'UNAUTHORIZED' ? 401 : 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireIngest(request);
    const body = (await request.json()) as {
      restaurantId?: string;
      event?: string;
      discoveries?: unknown[];
      folderPath?: string;
      channels?: { position: number; live?: boolean }[];
      error?: string;
    };
    const restaurantId = String(body.restaurantId ?? '');
    if (!restaurantId)
      return NextResponse.json({ error: 'restaurantId obrigatório.' }, { status: 400 });
    const admin = adminClient();
    const { data: restaurant } = await admin
      .from('restaurants')
      .select('id,tenant_id')
      .eq('id', restaurantId)
      .single();
    if (!restaurant)
      return NextResponse.json({ error: 'Restaurante não encontrado.' }, { status: 404 });
    const tenantId = restaurant.tenant_id as string;
    const now = new Date().toISOString();

    if (body.event === 'discoveries') {
      const discoveries = Array.isArray(body.discoveries) ? body.discoveries : [];
      await admin.from('sofia_sessions').upsert(
        {
          tenant_id: tenantId,
          restaurant_id: restaurantId,
          status: discoveries.length ? 'found' : 'need_folder',
          discoveries,
          selection: { command: 'idle' },
          agent_seen_at: now,
          last_error: discoveries.length
            ? null
            : 'Nenhum gravador nesta Wi-Fi. Use a pasta ou o celular.',
          updated_at: now,
        },
        { onConflict: 'restaurant_id' },
      );
      return NextResponse.json({ ok: true, count: discoveries.length });
    }

    if (body.event === 'folder_ready') {
      const folderPath = body.folderPath || 'C:\\CenaPronta\\cameras';
      const { data: cameras } = await admin
        .from('cameras')
        .select('id,position,source_config')
        .eq('restaurant_id', restaurantId)
        .eq('tenant_id', tenantId);
      for (const camera of cameras ?? []) {
        const config =
          camera.source_config && typeof camera.source_config === 'object'
            ? (camera.source_config as Record<string, unknown>)
            : {};
        await admin
          .from('cameras')
          .update({
            source_type: sourceTypeForMode('folder', 'nvr'),
            source_config: { ...config, ingestMode: 'folder', folderPath },
          })
          .eq('id', camera.id);
      }
      await admin.from('sofia_sessions').upsert(
        {
          tenant_id: tenantId,
          restaurant_id: restaurantId,
          status: 'ready',
          selection: { mode: 'folder', folderPath, command: 'idle' },
          agent_seen_at: now,
          last_error: null,
          updated_at: now,
        },
        { onConflict: 'restaurant_id' },
      );
      return NextResponse.json({ ok: true });
    }

    if (body.event === 'configured') {
      const { data: session } = await admin
        .from('sofia_sessions')
        .select('selection')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      const selection = (session?.selection ?? {}) as Record<string, unknown>;
      const { data: secret } = await admin
        .from('sofia_secrets')
        .select('username,password')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      const live = (body.channels ?? []).filter((item) => item.live);
      const { data: cameras } = await admin
        .from('cameras')
        .select('id,position,source_config,name')
        .eq('restaurant_id', restaurantId)
        .eq('tenant_id', tenantId)
        .order('position');
      for (const channel of live) {
        const camera = (cameras ?? []).find((item) => item.position === channel.position);
        if (!camera) continue;
        const config =
          camera.source_config && typeof camera.source_config === 'object'
            ? (camera.source_config as Record<string, unknown>)
            : {};
        await admin
          .from('cameras')
          .update({
            source_type: 'rtsp',
            source_config: {
              ...config,
              ingestMode: 'rtsp',
              rtspHost: selection.ip,
              rtspPort: '554',
              rtspUsername: secret?.username || 'admin',
              rtspBrand: selection.brand || 'intelbras',
              rtspChannel: channel.position,
              rtspTransport: 'tcp',
              rtspHasPassword: true,
            },
          })
          .eq('id', camera.id);
        if (secret?.password) await saveCameraPassword(camera.id, tenantId, secret.password);
      }
      if (live.length) {
        await admin.from('sofia_secrets').delete().eq('restaurant_id', restaurantId);
      }
      await admin.from('sofia_sessions').upsert(
        {
          tenant_id: tenantId,
          restaurant_id: restaurantId,
          status: live.length ? 'ready' : 'failed',
          selection: { ...selection, command: 'idle' },
          agent_seen_at: now,
          last_error: body.error || (live.length ? null : 'Senha ou canal recusado pelo gravador.'),
          updated_at: now,
        },
        { onConflict: 'restaurant_id' },
      );
      return NextResponse.json({ ok: true, live: live.length });
    }

    if (body.event === 'failed') {
      await admin
        .from('sofia_sessions')
        .update({
          status: 'failed',
          last_error: body.error || 'A Sofia não conseguiu ligar o gravador.',
          agent_seen_at: now,
          updated_at: now,
        })
        .eq('restaurant_id', restaurantId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message === 'UNAUTHORIZED' ? 'Chave de ingestão inválida.' : message },
      { status: message === 'UNAUTHORIZED' ? 401 : 400 },
    );
  }
}
