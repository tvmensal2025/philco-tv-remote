import { notFound } from 'next/navigation';
import AppShell from '@/components/app-shell';

export const dynamic = 'force-dynamic';

export default function E2EShellPage() {
  if (process.env.E2E_TEST_MODE !== '1') notFound();

  return (
    <AppShell
      tenantName="Restaurante E2E"
      tenantPlan="starter"
      memberships={[
        {
          tenantId: '00000000-0000-4000-8000-000000000001',
          name: 'Restaurante E2E',
          role: 'owner',
        },
      ]}
      activeTenantId="00000000-0000-4000-8000-000000000001"
      userEmail="teste@reelops.local"
      role="owner"
      runtimeConfig={{ supabaseUrl: 'https://e2e.invalid', supabaseAnonKey: 'e2e-anon-key' }}
    >
      <section aria-labelledby="fixture-title" className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Ambiente de teste
        </p>
        <h2 id="fixture-title" className="text-xl font-semibold">
          Conteúdo seguro para validar a navegação
        </h2>
        <p className="text-sm text-muted-foreground">
          Nenhuma conexão externa é usada nesta página.
        </p>
      </section>
    </AppShell>
  );
}
