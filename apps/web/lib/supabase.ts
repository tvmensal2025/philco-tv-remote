import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { cameraStoragePrefix } from '@reelops/shared';
import { isAuthBypass } from './auth-policy';
import { getServerEnv } from './env';

const OPEN_ACCESS_USER = { id: '00000000-0000-0000-0000-000000000001', email: 'cenapronta@local' };

export async function userClient() {
  const env = getServerEnv();
  const jar = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (items: { name: string; value: string; options?: Record<string, unknown> }[]) =>
        items.forEach(({ name, value, options }) => {
          try {
            jar.set(name, value, options as Parameters<typeof jar.set>[2]);
          } catch {}
        }),
    },
  });
}
export const adminClient = () => {
  const env = getServerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
};

async function bootstrapTenant(supabase: SupabaseClient) {
  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', 'cenapronta')
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data: tenant, error } = await supabase
    .from('tenants')
    .insert({ name: 'CENAPRONTA', slug: 'cenapronta', plan: 'starter' })
    .select('id')
    .single();
  if (error || !tenant) return null;
  const { data: restaurant } = await supabase
    .from('restaurants')
    .insert({ tenant_id: tenant.id, name: 'Restaurante', timezone: 'America/Sao_Paulo' })
    .select('id')
    .single();
  if (!restaurant) return tenant.id as string;
  await supabase.from('cameras').insert(
    [1, 2, 3, 4].map((position) => ({
      tenant_id: tenant.id,
      restaurant_id: restaurant.id,
      name: `Câmera ${position}`,
      position,
      storage_prefix: cameraStoragePrefix(tenant.id, restaurant.id, position),
    })),
  );
  return tenant.id as string;
}

export async function openAccessContext() {
  const supabase = adminClient();
  const jar = await cookies();
  const requestedTenant = jar.get('reelops-tenant')?.value;
  let { data: tenants } = await supabase
    .from('tenants')
    .select('id,name,plan')
    .order('created_at', { ascending: true });
  if (!tenants?.length) {
    await bootstrapTenant(supabase);
    const again = await supabase
      .from('tenants')
      .select('id,name,plan')
      .order('created_at', { ascending: true });
    tenants = again.data;
  }
  if (!tenants?.length) throw new Error('NO_TENANT');
  const tenant = tenants.find((item) => item.id === requestedTenant) ?? tenants[0];
  return {
    supabase,
    user: OPEN_ACCESS_USER,
    tenantId: tenant.id as string,
    tenant: tenant as { id: string; name: string; plan: string },
    role: 'owner' as const,
    memberships: tenants.map((item) => ({
      tenantId: item.id as string,
      role: 'owner',
      name: item.name as string,
    })),
  };
}

export async function requireContext() {
  if (isAuthBypass()) {
    const open = await openAccessContext();
    return { supabase: open.supabase, user: open.user, tenantId: open.tenantId, role: open.role };
  }
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('UNAUTHORIZED');
  const jar = await cookies();
  const selectedTenant = jar.get('reelops-tenant')?.value;
  let query = supabase
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .order('created_at')
    .limit(1);
  if (selectedTenant)
    query = supabase
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .eq('tenant_id', selectedTenant)
      .limit(1);
  let { data: membership } = await query.maybeSingle();
  if (!membership && selectedTenant) {
    const fallback = await supabase
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    membership = fallback.data;
  }
  if (!membership) throw new Error('NO_TENANT');
  return {
    supabase,
    user,
    tenantId: membership.tenant_id as string,
    role: membership.role as string,
  };
}

export function requireRole(role: string, allowed: readonly string[]) {
  if (!allowed.includes(role)) throw new Error('FORBIDDEN');
}
