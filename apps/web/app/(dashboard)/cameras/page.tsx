import CamerasManager from '@/components/cameras-manager';
import { dashboardContext } from '@/lib/dashboard-context';
import { defaultCameraRole, parseCameraRole, publicCameraSource } from '@reelops/shared';

export default async function CamerasPage() {
  const context = await dashboardContext();
  const { data: cameras } = await context.supabase
    .from('cameras')
    .select(
      'id,restaurant_id,name,position,enabled,storage_prefix,last_seen_at,source_config,source_type',
    )
    .eq('tenant_id', context.tenantId)
    .order('restaurant_id')
    .order('position');
  const { data: recordings } = await context.supabase
    .from('recordings')
    .select('id,camera_id,started_at')
    .eq('tenant_id', context.tenantId)
    .order('started_at', { ascending: false })
    .limit(80);
  const previewByCamera = new Map<string, string>();
  for (const recording of recordings ?? []) {
    if (!previewByCamera.has(recording.camera_id))
      previewByCamera.set(recording.camera_id, recording.id);
  }

  return (
    <CamerasManager
      cameras={(cameras ?? []).map((camera) => {
        const config =
          camera.source_config && typeof camera.source_config === 'object'
            ? (camera.source_config as Record<string, unknown>)
            : {};
        const role = parseCameraRole(config.role) ?? defaultCameraRole(camera.position);
        const source = publicCameraSource(camera.source_type, config);
        return {
          id: camera.id,
          restaurant_id: camera.restaurant_id,
          name: camera.name,
          position: camera.position,
          enabled: camera.enabled,
          last_seen_at: camera.last_seen_at,
          storage_prefix: camera.storage_prefix,
          role,
          place: typeof config.place === 'string' ? config.place : undefined,
          placeLabel: typeof config.placeLabel === 'string' ? config.placeLabel : null,
          ingestMode: source.ingestMode,
          rtspHost: source.rtspHost,
          rtspPort: source.rtspPort,
          rtspUsername: source.rtspUsername,
          rtspBrand: source.rtspBrand,
          rtspChannel: source.rtspChannel,
          rtspHasPassword: source.rtspHasPassword,
          rtspTransport: source.rtspTransport,
          folderPath: source.folderPath,
          previewId: previewByCamera.get(camera.id) ?? null,
        };
      })}
      restaurants={context.restaurants}
      role={context.role}
    />
  );
}
