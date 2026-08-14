import { dashboardContext } from '@/lib/dashboard-context';
import AnalyticsDashboard from '@/components/analytics-dashboard';

const getWeekAgo = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

export default async function AnalyticsPage() {
  const context = await dashboardContext();

  // Real data fetching for Analytics
  const { data: moments } = await context.supabase
    .from('moments')
    .select('occurred_at')
    .eq('tenant_id', context.tenantId)
    .gte('occurred_at', getWeekAgo());

  const { data: reels } = await context.supabase
    .from('reels')
    .select('created_at, status, score')
    .eq('tenant_id', context.tenantId)
    .gte('created_at', getWeekAgo());

  return <AnalyticsDashboard rawMoments={moments ?? []} rawReels={reels ?? []} />;
}
