import CamerasManager from '@/components/cameras-manager';
import { dashboardContext } from '@/lib/dashboard-context';
import { defaultCameraRole, parseCameraRole } from '@reelops/shared';

export default async function CamerasPage() {
  const context = await dashboardContext();
  const { data: cameras } = await context.supabase
    .from('cameras')
    .select('id,restaurant_id,name,position,enabled,storage_prefix,last_seen_at,source_config')
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
            ? (camera.source_config as { role?: string; place?: string; placeLabel?: string })
            : {};
        const role = parseCameraRole(config.role) ?? defaultCameraRole(camera.position);
        return {
          id: camera.id,
          restaurant_id: camera.restaurant_id,
          name: camera.name,
          position: camera.position,
          enabled: camera.enabled,
          last_seen_at: camera.last_seen_at,
          storage_prefix: camera.storage_prefix,
          role,
          place: config.place,
          placeLabel: config.placeLabel ?? null,
          previewId: previewByCamera.get(camera.id) ?? null,
        };
      })}
      restaurants={context.restaurants}
      role={context.role}
    />
  );
}
