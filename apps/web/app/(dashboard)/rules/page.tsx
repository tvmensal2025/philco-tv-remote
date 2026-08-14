import { dashboardContext } from '@/lib/dashboard-context';
import CaptureRules from '@/components/capture-rules';

export default async function RulesPage() {
  const context = await dashboardContext();
  return <CaptureRules restaurants={context.restaurants} role={context.role} />;
}
