import CamerasManager from "@/components/cameras-manager";
import { dashboardContext } from "@/lib/dashboard-context";

export default async function CamerasPage() {
  const context = await dashboardContext();
  const { data: cameras } = await context.supabase.from("cameras").select("id,restaurant_id,name,position,enabled,storage_prefix,last_seen_at,last_segment_path,source_type").eq("tenant_id", context.tenantId).order("restaurant_id").order("position");
  return <CamerasManager cameras={cameras ?? []} restaurants={context.restaurants} role={context.role}/>;
}
