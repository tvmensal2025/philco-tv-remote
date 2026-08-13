import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getServerEnv } from "./env";

export async function userClient() {
  const env = getServerEnv();
  const jar = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => jar.getAll(), setAll: (items: {name:string;value:string;options?:Record<string,unknown>}[]) => items.forEach(({name,value,options}) => { try { jar.set(name,value,options as any); } catch {} }) }
  });
}
export const adminClient = () => {
  const env = getServerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
};

export async function requireContext() {
  const supabase = await userClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHORIZED");
  const jar = await cookies();
  const selectedTenant = jar.get("reelops-tenant")?.value;
  let query = supabase.from("tenant_members").select("tenant_id, role").eq("user_id", user.id).order("created_at").limit(1);
  if (selectedTenant) query = supabase.from("tenant_members").select("tenant_id, role").eq("user_id", user.id).eq("tenant_id", selectedTenant).limit(1);
  let { data: membership } = await query.maybeSingle();
  if (!membership && selectedTenant) {
    const fallback = await supabase.from("tenant_members").select("tenant_id, role").eq("user_id", user.id).order("created_at").limit(1).maybeSingle();
    membership = fallback.data;
  }
  if (!membership) throw new Error("NO_TENANT");
  return { supabase, user, tenantId: membership.tenant_id as string, role: membership.role as string };
}

export function requireRole(role: string, allowed: readonly string[]) {
  if (!allowed.includes(role)) throw new Error("FORBIDDEN");
}
