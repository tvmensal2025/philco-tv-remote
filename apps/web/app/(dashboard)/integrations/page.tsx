import { dashboardContext } from '@/lib/dashboard-context';
import { getConfigItems, hasInstagramPublisher } from '@/lib/env';
import IntegrationsPanel from '@/components/integrations-panel';

export default async function IntegrationsPage() {
  await dashboardContext();
  return (
    <IntegrationsPanel
      items={getConfigItems().filter(
        (item) =>
          item.group === 'Publicação' ||
          item.group === 'Armazenamento' ||
          item.group === 'Supabase',
      )}
      instagramEnabled={hasInstagramPublisher()}
    />
  );
}
