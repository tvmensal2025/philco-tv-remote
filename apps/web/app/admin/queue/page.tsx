import AdminGate from '@/components/admin-gate';
import AdminQueuePanel from '@/components/admin-queue-panel';

export default function AdminQueuePage() {
  return (
    <AdminGate>
      <AdminQueuePanel />
    </AdminGate>
  );
}
