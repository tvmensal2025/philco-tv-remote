import { dashboardContext } from '@/lib/dashboard-context';
import AutomationSettings from '@/components/automation-settings';

export default async function AutomationPage() {
  const context = await dashboardContext();
  return <AutomationSettings restaurants={context.restaurants} role={context.role} />;
}
