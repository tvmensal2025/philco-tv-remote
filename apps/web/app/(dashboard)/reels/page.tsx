import ReelsLibrary from '@/components/reels-library';
import { dashboardContext } from '@/lib/dashboard-context';

export default async function ReelsPage() {
  const context = await dashboardContext();
  const { data: reels } = await context.supabase
    .from('reels')
    .select(
      'id,moment_id,status,title,thumbnail_path,output_path,progress,metadata,created_at,moments(occurred_at,label)',
    )
    .eq('tenant_id', context.tenantId)
    .neq('status', 'discarded')
    .order('created_at', { ascending: false })
    .limit(100);
  return (
    <ReelsLibrary
      reels={(reels ?? []).map((reel) => ({
        ...reel,
        metadata:
          reel.metadata && typeof reel.metadata === 'object'
            ? (reel.metadata as { program?: string })
            : null,
        moments: Array.isArray(reel.moments) ? (reel.moments[0] ?? null) : reel.moments,
      }))}
    />
  );
}
