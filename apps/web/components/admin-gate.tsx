import { redirect } from 'next/navigation';
import AdminShell from '@/components/admin-shell';
import { requirePlatformAdmin } from '@/lib/platform-admin';

export default async function AdminGate({ children }: { children: React.ReactNode }) {
  try {
    const admin = await requirePlatformAdmin();
    return (
      <AdminShell email={admin.user.email} role={admin.role}>
        {children}
      </AdminShell>
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') redirect('/login');
    redirect('/');
  }
}
