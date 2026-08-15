import DashboardOverview from '@/components/dashboard-overview';
import { dashboardContext } from '@/lib/dashboard-context';

function mapReel(reel: {
  id: string;
  moment_id?: string | null;
  status: string;
  title: string | null;
  thumbnail_path: string | null;
  output_path: string | null;
  progress?: number | null;
  metadata: unknown;
  created_at?: string;
  error_code?: string | null;
  error_message?: string | null;
  duration_seconds?: number | null;
  moments:
    | { occurred_at: string; label: string | null }
    | { occurred_at: string; label: string | null }[]
    | null;
}) {
  return {
    ...reel,
    metadata:
      reel.metadata && typeof reel.metadata === 'object'
        ? (reel.metadata as { program?: string })
        : null,
    moments: Array.isArray(reel.moments) ? (reel.moments[0] ?? null) : reel.moments,
  };
}

export default async function OverviewPage() {
  const context = await dashboardContext();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const reelSelect =
    'id,moment_id,status,title,thumbnail_path,output_path,progress,metadata,created_at,error_code,error_message,duration_seconds,moments(occurred_at,label)';
  const [{ data: recentReels }, { data: weekReels }, { data: moments }, { data: cameras }] =
    await Promise.all([
      context.supabase
        .from('reels')
        .select(reelSelect)
        .eq('tenant_id', context.tenantId)
        .neq('status', 'discarded')
        .order('created_at', { ascending: false })
        .limit(24),
      context.supabase
        .from('reels')
        .select(reelSelect)
        .eq('tenant_id', context.tenantId)
        .neq('status', 'discarded')
        .gte('created_at', weekAgo)
        .order('created_at', { ascending: false })
        .limit(200),
      context.supabase
        .from('moments')
        .select('occurred_at')
        .eq('tenant_id', context.tenantId)
        .gte('occurred_at', weekAgo)
        .order('occurred_at', { ascending: false })
        .limit(200),
      context.supabase
        .from('cameras')
        .select('id,restaurant_id,last_seen_at,enabled')
        .eq('tenant_id', context.tenantId),
    ]);

  return (
    <DashboardOverview
      initialReels={(recentReels ?? []).map(mapReel)}
      weekReels={(weekReels ?? []).map(mapReel)}
      weekMoments={moments ?? []}
      restaurants={context.restaurants}
      cameras={cameras ?? []}
      role={context.role}
      runtimeConfig={context.runtimeConfig}
    />
  );
}
