import { dashboardContext } from '@/lib/dashboard-context';
import MomentsTimeline from '@/components/moments-timeline';

export default async function MomentsPage() {
  const context = await dashboardContext();
  const { data: shots } = await context.supabase
    .from('reels')
    .select(
      'id,moment_id,status,title,thumbnail_path,output_path,progress,metadata,created_at,moments(occurred_at,label)',
    )
    .eq('tenant_id', context.tenantId)
    .neq('status', 'discarded')
    .order('created_at', { ascending: false })
    .limit(80);

  return (
    <MomentsTimeline
      shots={(shots ?? [])
        .filter((shot) => Boolean(shot.moment_id))
        .map((shot) => ({
          ...shot,
          metadata:
            shot.metadata && typeof shot.metadata === 'object'
              ? (shot.metadata as { program?: string })
              : null,
          moments: Array.isArray(shot.moments) ? (shot.moments[0] ?? null) : shot.moments,
        }))}
    />
  );
}
