import AppShell from "@/components/app-shell";
import { dashboardContext } from "@/lib/dashboard-context";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await dashboardContext();
  return (
    <AppShell
      tenantName={context.tenant.name}
      tenantPlan={context.tenant.plan}
      memberships={context.memberships}
      activeTenantId={context.tenantId}
      userEmail={context.user.email ?? ""}
      role={context.role}
      runtimeConfig={context.runtimeConfig}
    >
      {children}
    </AppShell>
  );
}
