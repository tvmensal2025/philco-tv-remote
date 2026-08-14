import AdminGate from '@/components/admin-gate';
import AdminFleet from '@/components/admin-fleet';

export default function AdminHomePage() {
  return (
    <AdminGate>
      <AdminFleet />
    </AdminGate>
  );
}
