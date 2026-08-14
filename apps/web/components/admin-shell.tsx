'use client';

import { Activity, Clapperboard, LayoutDashboard, Server, Shield } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

const navigation = [
  { href: '/admin', label: 'Frota', icon: LayoutDashboard },
  { href: '/admin/studio', label: 'Estúdio', icon: Clapperboard },
  { href: '/admin/health', label: 'Pulso', icon: Server },
  { href: '/admin/queue', label: 'Fila', icon: Activity },
];

export default function AdminShell(props: {
  children: React.ReactNode;
  email: string;
  role: string;
}) {
  const pathname = usePathname();
  const roleLabel = props.role === 'readonly' ? 'Leitura' : 'Administrador';

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3 px-5 pt-6 pb-5">
          <div className="flex size-11 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
            <Shield className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="font-heading text-base font-bold text-white">Plataforma</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
              CenaPronta · {roleLabel}
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Administração">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white',
                  active && 'bg-black/25 font-semibold text-white',
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-4 py-4 text-xs text-white/60">
          <p className="truncate">{props.email}</p>
          <Link href="/" className="mt-2 inline-block text-white/80 hover:text-white">
            Voltar à casa
          </Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex gap-2 overflow-x-auto lg:hidden">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full border px-3 py-1 text-xs font-medium"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="hidden min-w-0 flex-1 lg:block">
            <p className="text-sm font-medium">Administração da plataforma</p>
            <p className="text-xs text-muted-foreground">
              Frota, padrão dos 4 programas e pulso da fábrica.
            </p>
          </div>
          <ThemeToggle />
        </header>
        <main className="flex-1 p-4 sm:p-6 md:p-8">{props.children}</main>
      </div>
    </div>
  );
}
