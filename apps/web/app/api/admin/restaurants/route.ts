import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { restaurantOpsStatus } from '@/lib/restaurant-ops';
import { adminError } from '@/lib/admin-error';

export async function GET() {
  try {
    await requirePlatformAdmin();
    const db = adminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [
      { data: restaurants, error: restaurantsError },
      { data: cameras, error: camerasError },
      { data: reels, error: reelsError },
    ] = await Promise.all([
      db
        .from('restaurants')
        .select('id,name,timezone,created_at,tenant_id,tenants(name,plan,slug)')
        .order('created_at', { ascending: false }),
      db.from('cameras').select('restaurant_id,last_seen_at,enabled,position,name'),
      db.from('reels').select('restaurant_id,status').gte('created_at', since),
    ]);
    if (restaurantsError) throw restaurantsError;
    if (camerasError) throw camerasError;
    if (reelsError) throw reelsError;

    const camerasByRestaurant = new Map<string, typeof cameras>();
    for (const camera of cameras ?? []) {
      const list = camerasByRestaurant.get(camera.restaurant_id) ?? [];
      list.push(camera);
      camerasByRestaurant.set(camera.restaurant_id, list);
    }
    const reelsByRestaurant = new Map<string, typeof reels>();
    for (const reel of reels ?? []) {
      const list = reelsByRestaurant.get(reel.restaurant_id) ?? [];
      list.push(reel);
      reelsByRestaurant.set(reel.restaurant_id, list);
    }

    const rows = (restaurants ?? []).map((restaurant) => {
      const tenant = restaurant.tenants as unknown as {
        name: string;
        plan: string;
        slug: string;
      } | null;
      const houseCameras = camerasByRestaurant.get(restaurant.id) ?? [];
      const houseReels = reelsByRestaurant.get(restaurant.id) ?? [];
      const ops = restaurantOpsStatus({ cameras: houseCameras, reelsToday: houseReels });
      return {
        id: restaurant.id,
        name: restaurant.name,
        timezone: restaurant.timezone,
        createdAt: restaurant.created_at,
        tenantId: restaurant.tenant_id,
        tenantName: tenant?.name ?? '—',
        tenantPlan: tenant?.plan ?? 'starter',
        ...ops,
      };
    });

    return NextResponse.json({ restaurants: rows });
  } catch (error) {
    return adminError(error);
  }
}
