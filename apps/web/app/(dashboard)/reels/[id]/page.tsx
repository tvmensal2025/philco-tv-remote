import { dashboardContext } from '@/lib/dashboard-context';
import { hasInstagramPublisher } from '@/lib/env';
import type { ReelCutMetadata } from '@/lib/house-cut';
import { notFound } from 'next/navigation';
import ReelDetails from '@/components/reel-details';

export default async function ReelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await dashboardContext();
  const { data: reel } = await context.supabase
    .from('reels')
    .select(
      'id,moment_id,status,title,caption,thumbnail_path,output_path,progress,metadata,created_at,restaurants(name),moments(occurred_at,label)',
    )
    .eq('id', id)
    .eq('tenant_id', context.tenantId)
    .single();

  if (!reel) notFound();

  const { data: siblings } = reel.moment_id
    ? await context.supabase
        .from('reels')
        .select(
          'id,moment_id,status,title,caption,thumbnail_path,output_path,progress,metadata,created_at,moments(occurred_at,label)',
        )
        .eq('tenant_id', context.tenantId)
        .eq('moment_id', reel.moment_id)
        .neq('status', 'discarded')
    : { data: [reel] };

  const asShot = (row: {
    id: string;
    moment_id: string | null;
    status: string;
    title: string | null;
    caption?: string | null;
    thumbnail_path: string | null;
    output_path: string | null;
    progress: number | null;
    metadata: unknown;
    created_at: string;
    restaurants?: { name: string } | { name: string }[] | null;
    moments?:
      | { occurred_at: string; label: string | null }
      | { occurred_at: string; label: string | null }[]
      | null;
  }) => ({
    ...row,
    metadata:
      row.metadata && typeof row.metadata === 'object' ? (row.metadata as ReelCutMetadata) : null,
    moments: Array.isArray(row.moments) ? (row.moments[0] ?? null) : (row.moments ?? null),
    restaurants: Array.isArray(row.restaurants)
      ? (row.restaurants[0] ?? null)
      : (row.restaurants ?? null),
  });

  return (
    <ReelDetails
      reel={asShot(reel)}
      siblings={(siblings ?? [reel]).map((item) => asShot(item))}
      instagramEnabled={hasInstagramPublisher()}
    />
  );
}
