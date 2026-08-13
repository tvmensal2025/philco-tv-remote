import DashboardOverview from "@/components/dashboard-overview";
import { dashboardContext } from "@/lib/dashboard-context";
import { hasInstagramPublisher } from "@/lib/env";

export default async function OverviewPage() {
  const context = await dashboardContext();
  const { data: reels } = await context.supabase.from("reels").select("*,restaurants(name),moments(occurred_at,label)").eq("tenant_id", context.tenantId).order("created_at", { ascending: false }).limit(12);
  const { data: cameras } = await context.supabase.from("cameras").select("id,restaurant_id,last_seen_at,enabled").eq("tenant_id", context.tenantId);
  return <DashboardOverview initialReels={reels ?? []} restaurants={context.restaurants} cameras={cameras ?? []} role={context.role} runtimeConfig={context.runtimeConfig} instagramEnabled={hasInstagramPublisher()}/>;
}
