import AdminGate from '@/components/admin-gate';
import AdminHealthPanel from '@/components/admin-health-panel';

export default function AdminHealthPage() {
  return (
    <AdminGate>
      <AdminHealthPanel />
    </AdminGate>
  );
}
