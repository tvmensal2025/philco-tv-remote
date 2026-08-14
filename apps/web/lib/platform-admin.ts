import { isAuthBypass } from './auth-policy';
import { getServerEnv } from './env';
import {
  isPlatformAdminEmail,
  parsePlatformAdminEmails,
  type PlatformAdminRole,
} from './platform-admin-policy';
import { adminClient, userClient } from './supabase';

export type { PlatformAdminRole } from './platform-admin-policy';
export { isPlatformAdminEmail, parsePlatformAdminEmails } from './platform-admin-policy';

export type PlatformAdmin = {
  user: { id: string; email: string };
  role: PlatformAdminRole;
};

export async function lookupPlatformAdmin(input: {
  userId: string;
  email?: string | null;
}): Promise<PlatformAdmin | null> {
  if (isAuthBypass()) {
    return { user: { id: input.userId, email: input.email ?? 'cenapronta@local' }, role: 'owner' };
  }
  const allowlist = parsePlatformAdminEmails(process.env.PLATFORM_ADMIN_EMAILS);
  const email = input.email?.trim().toLowerCase() ?? '';
  const db = adminClient();
  if (isPlatformAdminEmail(email, allowlist)) {
    const { error: upsertError } = await db
      .from('platform_admins')
      .upsert({ user_id: input.userId, role: 'owner' }, { onConflict: 'user_id' });
    if (upsertError && !/does not exist|schema cache|platform_admins/i.test(upsertError.message))
      throw upsertError;
    return { user: { id: input.userId, email }, role: 'owner' };
  }
  const { data, error } = await db
    .from('platform_admins')
    .select('role')
    .eq('user_id', input.userId)
    .maybeSingle();
  if (error) {
    if (/does not exist|schema cache|platform_admins/i.test(error.message)) return null;
    throw error;
  }
  if (!data) return null;
  const role = data.role === 'support' || data.role === 'readonly' ? data.role : 'owner';
  return { user: { id: input.userId, email }, role };
}

export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  getServerEnv();
  if (isAuthBypass()) {
    return {
      user: { id: '00000000-0000-0000-0000-000000000001', email: 'cenapronta@local' },
      role: 'owner',
    };
  }
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('UNAUTHORIZED');
  const admin = await lookupPlatformAdmin({ userId: user.id, email: user.email });
  if (!admin) throw new Error('FORBIDDEN');
  return admin;
}

export async function writeAdminAudit(input: {
  actorUserId: string;
  action: string;
  targetTenantId?: string | null;
  targetRestaurantId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const { error } = await adminClient()
    .from('admin_audit_events')
    .insert({
      actor_user_id: input.actorUserId,
      action: input.action,
      target_tenant_id: input.targetTenantId ?? null,
      target_restaurant_id: input.targetRestaurantId ?? null,
      payload: input.payload ?? {},
    });
  if (error && !/does not exist|schema cache|admin_audit_events/i.test(error.message)) throw error;
}

export function assertPlatformWrite(role: PlatformAdminRole) {
  if (role === 'readonly') throw new Error('FORBIDDEN');
}
