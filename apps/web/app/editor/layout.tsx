import { dashboardContext } from '@/lib/dashboard-context';

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  await dashboardContext();
  return children;
}
