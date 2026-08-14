import AdminGate from '@/components/admin-gate';
import AdminProgramStudio from '@/components/admin-program-studio';

export default function AdminStudioPage() {
  return (
    <AdminGate>
      <AdminProgramStudio />
    </AdminGate>
  );
}
