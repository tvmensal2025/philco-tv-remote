import DashboardOverview from '@/components/dashboard-overview';
import { dashboardContext } from '@/lib/dashboard-context';

export default async function OverviewPage() {
  const context = await dashboardContext();
  const { data: reels } = await context.supabase
    .from('reels')
    .select(
      'id,moment_id,status,title,thumbnail_path,output_path,progress,metadata,created_at,moments(occurred_at,label)',
    )
    .eq('tenant_id', context.tenantId)
    .neq('status', 'discarded')
    .order('created_at', { ascending: false })
    .limit(24);
  const { data: cameras } = await context.supabase
    .from('cameras')
    .select('id,restaurant_id,last_seen_at,enabled')
    .eq('tenant_id', context.tenantId);

  return (
    <DashboardOverview
      initialReels={(reels ?? []).map((reel) => ({
        ...reel,
        metadata:
          reel.metadata && typeof reel.metadata === 'object'
            ? (reel.metadata as { program?: string })
            : null,
        moments: Array.isArray(reel.moments) ? (reel.moments[0] ?? null) : reel.moments,
      }))}
      restaurants={context.restaurants}
      cameras={cameras ?? []}
      role={context.role}
      runtimeConfig={context.runtimeConfig}
    />
  );
}
