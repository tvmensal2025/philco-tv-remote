'use client';

import { createBrowserClient } from '@supabase/ssr';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Shield,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

const navigation = [
  {
    group: 'A casa',
    items: [
      { href: '/', label: 'Início', icon: LayoutDashboard },
      { href: '/reels', label: 'Filmes', icon: Clapperboard },
      { href: '/settings', label: 'Conta', icon: Settings },
    ],
  },
];

const pageMeta: Record<string, { title: string; description: string }> = {
  '/enviar': { title: 'Enviar', description: 'Mande o vídeo do celular. Sem HD.' },
  '/moments': { title: 'Turno', description: 'Cada instante que virou filme.' },
  '/reels': { title: 'Filmes', description: 'Revisar, aprovar, baixar.' },
  '/editor': { title: 'Editor', description: 'Timeline do projeto. O MP4 é só o export.' },
  '/cameras': { title: 'Câmeras', description: 'Os ângulos da casa.' },
  '/recordings': { title: 'Fita', description: 'Escolha o instante na gravação.' },
  '/estudio': { title: 'Estúdio', description: 'Ritmo, o que roda sozinho, o que priorizar.' },
  '/automation': { title: 'Estúdio', description: 'O que o sistema faz sozinho no turno.' },
  '/rules': { title: 'Estúdio', description: 'O que priorizar na hora de cortar.' },
  '/styles': { title: 'Estúdio', description: 'Ritmo dos próximos Reels.' },
  '/analytics': { title: 'Relatórios', description: 'Como o turno performou.' },
  '/integrations': { title: 'Conexões', description: 'WhatsApp e Instagram.' },
  '/settings': { title: 'Conta', description: 'Nome, fuso e janela de corte.' },
};

type Props = {
  children: React.ReactNode;
  tenantName: string;
  tenantPlan: string;
  memberships: { tenantId: string; name: string; role: string }[];
  activeTenantId: string;
  userEmail: string;
  role: string;
  runtimeConfig: { supabaseUrl: string; supabaseAnonKey: string };
  openAccess?: boolean;
  isPlatformAdmin?: boolean;
};

export default function AppShell(props: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [switching, setSwitching] = useState(false);
  const supabase = useMemo(
    () => createBrowserClient(props.runtimeConfig.supabaseUrl, props.runtimeConfig.supabaseAnonKey),
    [props.runtimeConfig],
  );

  let activePath = '/';
  for (const group of navigation) {
    for (const item of group.items) {
      if (pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))) {
        activePath = item.href;
      }
    }
  }
  if (
    [
      '/automation',
      '/rules',
      '/styles',
      '/estudio',
      '/cameras',
      '/recordings',
      '/integrations',
    ].some((path) => pathname === path || pathname.startsWith(`${path}/`))
  ) {
    activePath = '/settings';
  }

  const meta = pageMeta[pathname] ||
    pageMeta[activePath] || { title: 'CenaPronta', description: '' };
  const roleLabel = props.role === 'owner' ? 'Proprietário' : 'Membro';
  const initials = (props.tenantName || 'R').slice(0, 1).toUpperCase();
  const userInitials = (props.userEmail || 'U').slice(0, 1).toUpperCase();
  const displayName = props.openAccess ? 'Acesso aberto' : props.userEmail.split('@')[0];
  const displayEmail = props.openAccess ? 'sem login por enquanto' : props.userEmail;

  async function switchTenant(tenantId: string) {
    setSwitching(true);
    await fetch('/api/tenant/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId }),
    });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/');
  }

  async function signOut() {
    await supabase.auth.signOut();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/login');
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex h-[100dvh] flex-col text-sidebar-foreground shadow-2xl transition-all duration-300 lg:sticky lg:top-0',
          'bg-[linear-gradient(180deg,color-mix(in_srgb,var(--sidebar)_92%,black)_0%,var(--sidebar)_100%)]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          collapsed ? 'w-[72px]' : 'w-72',
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center gap-3 pt-6 pb-5',
            collapsed ? 'justify-center px-2' : 'px-5',
          )}
        >
          <div className="rounded-full bg-[linear-gradient(135deg,var(--sidebar-primary),var(--primary),color-mix(in_srgb,var(--primary)_70%,black))] p-[2px]">
            <div className="flex size-12 items-center justify-center overflow-hidden rounded-full bg-sidebar">
              <span className="font-heading text-base font-bold text-sidebar-primary">
                {initials}
              </span>
            </div>
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-base font-bold leading-tight text-white">
                {props.tenantName}
              </p>
              <p className="mt-1 truncate text-[9px] font-bold uppercase tracking-[0.22em] text-white/70">
                {props.tenantPlan || 'CenaPronta'} · {roleLabel}
              </p>
            </div>
          )}
        </div>

        {props.memberships.length > 1 && !collapsed && (
          <div className="px-3 pb-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  disabled={switching}
                  className="h-auto w-full justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-white hover:bg-white/10 hover:text-white"
                >
                  <span className="truncate text-sm">{props.tenantName}</span>
                  <ChevronDown className="size-4 shrink-0 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Estabelecimentos</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {props.memberships.map((membership) => (
                  <DropdownMenuItem
                    key={membership.tenantId}
                    onClick={() => switchTenant(membership.tenantId)}
                    className={cn(membership.tenantId === props.activeTenantId && 'bg-accent')}
                  >
                    {membership.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <nav
          className={cn(
            'sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden pb-4',
            collapsed ? 'px-1' : 'px-3',
          )}
          aria-label="Navegação principal"
        >
          {navigation.map((group) => (
            <div key={group.group}>
              {collapsed ? (
                <Separator className="mx-3 my-2 bg-white/10" />
              ) : (
                <div className="mt-4 mb-1.5 px-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
                  {group.group}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activePath === item.href;
                  const link = (
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-[10px] border-l-[3px] border-transparent text-sm font-medium text-white/70 transition-colors',
                        collapsed ? 'mx-2 justify-center px-0 py-2.5' : 'px-3.5 py-2.5',
                        isActive
                          ? collapsed
                            ? 'border-transparent bg-sidebar-primary text-white'
                            : 'border-sidebar-primary bg-black/25 font-semibold text-white'
                          : 'hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-[18px] shrink-0',
                          isActive && !collapsed && 'text-sidebar-primary',
                        )}
                      />
                      {!collapsed && <span className="truncate">{item.label}</span>}
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
              </div>
            </div>
          ))}
          {props.isPlatformAdmin && (
            <div>
              {collapsed ? (
                <Separator className="mx-3 my-2 bg-white/10" />
              ) : (
                <div className="mt-4 mb-1.5 px-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
                  Plataforma
                </div>
              )}
              <Link
                href="/admin"
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-[10px] border-l-[3px] border-transparent text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white',
                  collapsed ? 'mx-2 justify-center px-0 py-2.5' : 'px-3.5 py-2.5',
                )}
              >
                <Shield className="size-[18px] shrink-0" />
                {!collapsed && <span>Administração</span>}
              </Link>
            </div>
          )}
        </nav>

        <div className={cn('shrink-0 border-t border-white/10 py-3', collapsed ? 'px-2' : 'px-3')}>
          <div
            className={cn(
              'mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-white/70',
              collapsed && 'justify-center px-0',
            )}
          >
            <CheckCircle2 className="size-4 text-sidebar-primary" />
            {!collapsed && <span>CenaPronta</span>}
          </div>
          {!props.openAccess && (
            <button
              type="button"
              onClick={signOut}
              className={cn(
                'flex w-full items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white',
                collapsed && 'justify-center px-0',
              )}
            >
              <LogOut className="size-[18px] shrink-0" />
              {!collapsed && <span>Sair da conta</span>}
            </button>
          )}
        </div>

        <button
          type="button"
          className="absolute top-20 -right-3 hidden size-6 items-center justify-center rounded-full border bg-card text-foreground shadow-sm lg:flex"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-4 border-b bg-background/80 px-4 shadow-sm backdrop-blur-md sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </Button>

          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <h1 className="truncate text-lg font-semibold tracking-tight">{meta.title}</h1>
            <p className="hidden truncate text-sm text-muted-foreground sm:block">
              {meta.description}
            </p>
          </div>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto gap-3 rounded-full px-1.5 py-1.5 sm:rounded-xl sm:px-2"
              >
                <div className="hidden flex-col items-end text-sm sm:flex">
                  <span className="font-medium leading-none">{displayName}</span>
                  <span className="text-xs text-muted-foreground">{displayEmail}</span>
                </div>
                <Avatar className="size-9">
                  <AvatarFallback className="bg-primary/10 font-medium text-primary">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="truncate">{displayEmail}</p>
                <p className="text-xs font-normal text-muted-foreground">{roleLabel}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">Conta</Link>
              </DropdownMenuItem>
              {!props.openAccess && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut}>Sair da conta</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-x-hidden p-4 sm:p-6 md:p-8">{props.children}</main>
      </div>
    </div>
  );
}
