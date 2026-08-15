'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  Clapperboard,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Shield,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const navigation = [
  { href: '/admin', label: 'Frota', icon: LayoutDashboard },
  { href: '/admin/studio', label: 'Estúdio', icon: Clapperboard },
  { href: '/admin/health', label: 'Pulso', icon: Server },
  { href: '/admin/queue', label: 'Fila', icon: Activity },
];

const NAV_KEY = 'cenapronta.admin-nav';

export default function AdminShell(props: {
  children: React.ReactNode;
  email: string;
  role: string;
}) {
  const pathname = usePathname();
  const roleLabel = props.role === 'readonly' ? 'Leitura' : 'Administrador';
  const [collapsed, setCollapsed] = useState(false);
  const studio = pathname.startsWith('/admin/studio');

  useEffect(() => {
    if (window.localStorage.getItem(NAV_KEY) === 'collapsed') setCollapsed(true);
  }, []);

  function toggleNav() {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem(NAV_KEY, next ? 'collapsed' : 'open');
      return next;
    });
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside
        className={cn(
          'sticky top-0 hidden h-[100dvh] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[72px]' : 'w-64',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-3 pt-6 pb-5',
            collapsed ? 'justify-center px-2' : 'px-5',
          )}
        >
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
            <Shield className="size-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="font-heading text-base font-bold text-white">Plataforma</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
                CenaPronta · {roleLabel}
              </p>
            </div>
          )}
        </div>
        <nav
          className={cn('flex-1 space-y-1', collapsed ? 'px-2' : 'px-3')}
          aria-label="Administração"
        >
          {navigation.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
            const link = (
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className={cn(
                  'flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white',
                  collapsed ? 'justify-center px-0' : 'px-3',
                  active && 'bg-black/25 font-semibold text-white',
                )}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && item.label}
              </Link>
            );
            if (!collapsed) return <div key={item.href}>{link}</div>;
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
        <div
          className={cn(
            'border-t border-white/10 py-4 text-xs text-white/60',
            collapsed ? 'px-2 text-center' : 'px-4',
          )}
        >
          {!collapsed && <p className="truncate">{props.email}</p>}
          {!collapsed && (
            <Link href="/" className="mt-2 inline-block text-white/80 hover:text-white">
              Voltar à casa
            </Link>
          )}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/80 px-3 backdrop-blur-md sm:px-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="hidden lg:inline-flex"
            onClick={toggleNav}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
            {collapsed ? 'Abrir menu' : 'Recolher menu'}
          </Button>
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
              {studio
                ? 'Padrão dos 4 programas — o que os restaurantes passam a montar.'
                : 'Frota, padrão dos 4 programas e pulso da fábrica.'}
            </p>
          </div>
          <ThemeToggle />
        </header>
        <main className={cn('flex-1', studio ? 'p-3 sm:p-4' : 'p-4 sm:p-6 md:p-8')}>
          {props.children}
        </main>
      </div>
    </div>
  );
}
