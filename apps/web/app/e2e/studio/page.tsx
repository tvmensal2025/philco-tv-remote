import { notFound } from 'next/navigation';
import AdminProgramStudio from '@/components/admin-program-studio';

export const dynamic = 'force-dynamic';

export default function E2EStudioPage() {
  if (process.env.E2E_TEST_MODE !== '1') notFound();

  return (
    <main className="h-dvh overflow-hidden">
      <AdminProgramStudio mode="fixture" />
    </main>
  );
}
