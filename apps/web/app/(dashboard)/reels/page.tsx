import ReelsLibrary from "@/components/reels-library";
import { dashboardContext } from "@/lib/dashboard-context";

export default async function ReelsPage() {
  const context = await dashboardContext();
  const { data: reels } = await context.supabase.from("reels").select("*,restaurants(name),moments(occurred_at,label)").eq("tenant_id", context.tenantId).neq("status", "discarded").order("created_at", { ascending: false }).limit(100);
  return <ReelsLibrary reels={reels ?? []}/>;
}
