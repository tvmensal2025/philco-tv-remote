import { dashboardContext } from '@/lib/dashboard-context';
import PhoneIngest from '@/components/phone-ingest';

export default async function EnviarPage({
  searchParams,
}: {
  searchParams: Promise<{ share?: string }>;
}) {
  const context = await dashboardContext();
  const params = await searchParams;
  const { data: cameras } = await context.supabase
    .from('cameras')
    .select('id,name,position,restaurant_id,enabled')
    .eq('tenant_id', context.tenantId)
    .eq('enabled', true)
    .order('position');

  return (
    <PhoneIngest
      cameras={cameras ?? []}
      restaurants={context.restaurants}
      shareId={params.share ?? null}
    />
  );
}
