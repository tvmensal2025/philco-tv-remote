import { dashboardContext } from '@/lib/dashboard-context';
import RecordingsBrowser from '@/components/recordings-browser';
import { cameraPlaceOf, defaultPlace } from '@/lib/camera-roles';
import { defaultCameraRole, parseCameraRole } from '@reelops/shared';

export default async function RecordingsPage() {
  const context = await dashboardContext();
  const { data: recordings } = await context.supabase
    .from('recordings')
    .select(
      'id,object_key,started_at,ended_at,duration_seconds,size_bytes,camera_id,index_status,cameras(name,position)',
    )
    .eq('tenant_id', context.tenantId)
    .order('started_at', { ascending: false })
    .limit(80);
  const { data: cameras } = await context.supabase
    .from('cameras')
    .select('id,name,position,restaurant_id,enabled,source_config,storage_prefix')
    .eq('tenant_id', context.tenantId)
    .eq('enabled', true)
    .order('position');

  return (
    <RecordingsBrowser
      recordings={(recordings ?? []).map((item) => ({
        ...item,
        cameras: Array.isArray(item.cameras) ? (item.cameras[0] ?? null) : item.cameras,
      }))}
      cameras={(cameras ?? []).map((camera) => {
        const config =
          camera.source_config && typeof camera.source_config === 'object'
            ? (camera.source_config as { role?: string; place?: string; placeLabel?: string })
            : {};
        const role = parseCameraRole(config.role) ?? defaultCameraRole(camera.position);
        return {
          id: camera.id,
          name: camera.name,
          position: camera.position,
          restaurant_id: camera.restaurant_id,
          enabled: camera.enabled,
          storage_prefix: camera.storage_prefix,
          role,
          place:
            cameraPlaceOf(config.place, role, camera.position) ?? defaultPlace(camera.position),
          placeLabel: config.placeLabel ?? null,
        };
      })}
      restaurants={context.restaurants}
    />
  );
}
