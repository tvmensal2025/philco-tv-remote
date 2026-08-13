import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPublicRuntimeConfig, isCoreConfigured } from "./env";
import { userClient } from "./supabase";

export async function dashboardContext() {
  if (!isCoreConfigured()) redirect("/setup");
  const supabase = await userClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships, error } = await supabase
    .from("tenant_members")
    .select("tenant_id,role,tenants(id,name,plan)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!memberships?.length) redirect("/onboarding");

  const jar = await cookies();
  const requestedTenant = jar.get("reelops-tenant")?.value;
  const membership = memberships.find((item) => item.tenant_id === requestedTenant) ?? memberships[0];
  const tenantId = membership.tenant_id as string;
  const tenant = membership.tenants as unknown as { id: string; name: string; plan: string };
  const { data: restaurants, error: restaurantsError } = await supabase
    .from("restaurants")
    .select("id,name,timezone,settings")
    .eq("tenant_id", tenantId)
    .order("created_at");
  if (restaurantsError) throw restaurantsError;

  return {
    supabase,
    user,
    tenantId,
    tenant,
    role: membership.role as "owner" | "admin" | "editor" | "viewer",
    memberships: memberships.map((item) => ({
      tenantId: item.tenant_id as string,
      role: item.role as string,
      name: (item.tenants as unknown as { name: string }).name
    })),
    restaurants: (restaurants ?? []) as { id: string; name: string; timezone: string; settings: Record<string, unknown> }[],
    runtimeConfig: getPublicRuntimeConfig()
  };
}
