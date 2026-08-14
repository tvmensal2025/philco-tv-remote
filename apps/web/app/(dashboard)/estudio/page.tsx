import { dashboardContext } from '@/lib/dashboard-context';
import EstudioHub from '@/components/estudio-hub';

export default async function EstudioPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const context = await dashboardContext();
  const { tab } = await searchParams;
  return <EstudioHub restaurants={context.restaurants} role={context.role} defaultTab={tab} />;
}
