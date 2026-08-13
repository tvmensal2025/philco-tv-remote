import StylesManager from "@/components/styles-manager";
import { dashboardContext } from "@/lib/dashboard-context";

export default async function StylesPage() {
  const context = await dashboardContext();
  return <StylesManager restaurants={context.restaurants} role={context.role}/>;
}
