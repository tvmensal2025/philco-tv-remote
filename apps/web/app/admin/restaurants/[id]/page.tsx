import AdminGate from '@/components/admin-gate';
import AdminRestaurantDetail from '@/components/admin-restaurant-detail';

export default async function AdminRestaurantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminGate>
      <AdminRestaurantDetail restaurantId={id} />
    </AdminGate>
  );
}
