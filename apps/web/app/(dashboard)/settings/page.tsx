import SettingsPanel from "@/components/settings-panel";
import { getConfigItems, hasInstagramPublisher } from "@/lib/env";
import { dashboardContext } from "@/lib/dashboard-context";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await dashboardContext();
  return <SettingsPanel restaurants={context.restaurants} role={context.role} configItems={getConfigItems().map(({ key, label, group, configured, required, hint }) => ({ key, label, group, configured, required, hint }))} instagramEnabled={hasInstagramPublisher()}/>;
}
