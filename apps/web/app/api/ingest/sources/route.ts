import { NextResponse } from 'next/server';
import { ingestModeOf } from '@reelops/shared';
import { adminClient } from '@/lib/supabase';
import { getServerEnv } from '@/lib/env';
import { enforceRateLimit } from '@/lib/rate-limit';
import { cameraRtspUrl, loadCameraPassword } from '@/lib/camera-rtsp';

export async function GET(request: Request) {
  try {
    const env = getServerEnv();
    if (request.headers.get('authorization') !== `Bearer ${env.INGEST_API_KEY}`) {
      return NextResponse.json({ error: 'Chave de ingestão inválida.' }, { status: 401 });
    }
    const restaurantId = new URL(request.url).searchParams.get('restaurantId');
    if (!restaurantId)
      return NextResponse.json({ error: 'restaurantId obrigatório.' }, { status: 400 });
    await enforceRateLimit(`ingest-sources:${restaurantId}`, 60, 60);
    const admin = adminClient();
    const { data: restaurant } = await admin
      .from('restaurants')
      .select('id,timezone')
      .eq('id', restaurantId)
      .single();
    if (!restaurant)
      return NextResponse.json({ error: 'Restaurante não encontrado.' }, { status: 404 });
    const { data: cameras } = await admin
      .from('cameras')
      .select('id,position,name,enabled,source_type,source_config')
      .eq('restaurant_id', restaurantId)
      .eq('enabled', true)
      .order('position');
    const mapped = [];
    for (const camera of cameras ?? []) {
      const config =
        camera.source_config && typeof camera.source_config === 'object'
          ? (camera.source_config as Record<string, unknown>)
          : {};
      const ingestMode = ingestModeOf(camera.source_type, config);
      const password = ingestMode === 'rtsp' ? await loadCameraPassword(camera.id) : '';
      mapped.push({
        id: camera.id,
        position: camera.position,
        name: camera.name,
        enabled: camera.enabled,
        ingestMode,
        sourceType: camera.source_type,
        rtspUrl:
          ingestMode === 'rtsp'
            ? cameraRtspUrl({ config, password, position: camera.position })
            : '',
        rtspTransport: config.rtspTransport === 'udp' ? 'udp' : 'tcp',
        folderPath: typeof config.folderPath === 'string' ? config.folderPath : '',
      });
    }
    return NextResponse.json({
      restaurantId: restaurant.id,
      timezone: restaurant.timezone,
      cameras: mapped,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao listar fontes.' },
      { status: 400 },
    );
  }
}
