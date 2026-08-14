import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { adminClient, userClient } from '@/lib/supabase';
import { isAuthBypass } from '@/lib/env';

export async function POST(request: Request) {
  const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(await request.json());
  if (isAuthBypass()) {
    const { data } = await adminClient()
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 403 });
  } else {
    const supabase = await userClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
    const { data } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 403 });
  }
  const jar = await cookies();
  jar.set('reelops-tenant', tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.json({ ok: true });
}
