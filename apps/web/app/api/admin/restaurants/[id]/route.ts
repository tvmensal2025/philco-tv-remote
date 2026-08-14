import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { restaurantOpsStatus } from '@/lib/restaurant-ops';
import { adminError } from '@/lib/admin-error';

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const db = adminClient();
    const { data: restaurant, error } = await db
      .from('restaurants')
      .select('id,name,timezone,created_at,tenant_id,settings,tenants(name,plan,slug)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!restaurant)
      return NextResponse.json({ error: 'Restaurante não encontrado.' }, { status: 404 });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data: cameras }, { data: reels }, { data: members }, { data: recordings }] =
      await Promise.all([
        db
          .from('cameras')
          .select('id,name,position,enabled,last_seen_at,last_segment_path,role')
          .eq('restaurant_id', id)
          .order('position'),
        db
          .from('reels')
          .select('id,status,title,error_code,error_message,created_at,progress')
          .eq('restaurant_id', id)
          .order('created_at', { ascending: false })
          .limit(24),
        db
          .from('tenant_members')
          .select('user_id,role,created_at')
          .eq('tenant_id', restaurant.tenant_id),
        db
          .from('recordings')
          .select('id,camera_id,started_at,duration_seconds,timestamp_confidence')
          .eq('restaurant_id', id)
          .order('started_at', { ascending: false })
          .limit(12),
      ]);

    const ops = restaurantOpsStatus({
      cameras: cameras ?? [],
      reelsToday: (reels ?? []).filter((reel) => reel.created_at >= since),
    });
    const tenant = restaurant.tenants as unknown as {
      name: string;
      plan: string;
      slug: string;
    } | null;

    return NextResponse.json({
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        timezone: restaurant.timezone,
        createdAt: restaurant.created_at,
        tenantId: restaurant.tenant_id,
        tenantName: tenant?.name ?? '—',
        tenantPlan: tenant?.plan ?? 'starter',
        tenantSlug: tenant?.slug ?? '',
      },
      ops,
      cameras: cameras ?? [],
      reels: reels ?? [],
      members: members ?? [],
      recordings: recordings ?? [],
    });
  } catch (error) {
    return adminError(error);
  }
}
