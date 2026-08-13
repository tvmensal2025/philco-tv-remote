"use client";

import { createBrowserClient } from "@supabase/ssr";
import { Camera, ChevronDown, Clapperboard, LayoutDashboard, LogOut, Menu, Palette, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

const navigation = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/reels", label: "Meus Reels", icon: Clapperboard },
  { href: "/cameras", label: "Câmeras", icon: Camera },
  { href: "/styles", label: "Estilos", icon: Palette },
  { href: "/settings", label: "Configurações", icon: Settings }
];

const pageMeta: Record<string, { eyebrow: string; title: string; description: string }> = {
  "/": { eyebrow: "VISÃO GERAL", title: "Sua operação, em um olhar", description: "Acompanhe os momentos que estão virando conteúdo." },
  "/reels": { eyebrow: "BIBLIOTECA", title: "Seus melhores momentos", description: "Revise, aprove e exporte cada Reel com confiança." },
  "/cameras": { eyebrow: "CAPTURA", title: "Câmeras e sinais", description: "Acompanhe a chegada dos segmentos de cada ângulo." },
  "/styles": { eyebrow: "DIREÇÃO CRIATIVA", title: "A personalidade da sua marca", description: "Escolha como os próximos Reels serão montados." },
  "/settings": { eyebrow: "CONFIGURAÇÕES", title: "Central de controle", description: "Ajuste a operação e confirme a saúde das integrações." }
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
};

export default function AppShell(props: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const supabase = useMemo(() => createBrowserClient(props.runtimeConfig.supabaseUrl, props.runtimeConfig.supabaseAnonKey), [props.runtimeConfig]);
  const activePath = pathname.startsWith("/reels") ? "/reels" : pathname.startsWith("/cameras") ? "/cameras" : pathname.startsWith("/styles") ? "/styles" : pathname.startsWith("/settings") ? "/settings" : "/";
  const meta = pageMeta[activePath];

  async function switchTenant(tenantId: string) {
    setSwitching(true);
    await fetch("/api/tenant/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId }) });
    location.href = "/";
  }

  async function signOut() {
    await supabase.auth.signOut();
    location.href = "/login";
  }

  return (
    <div className="appFrame">
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebarTop">
          <Link href="/" className="brand"><span className="brandMark">R</span><span>ReelOps</span></Link>
          <button className="mobileClose" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X/></button>
        </div>
        <nav className="mainNav" aria-label="Navegação principal">
          <span className="navLabel">MENU</span>
          {navigation.map((item) => {
            const Icon = item.icon;
            return <Link href={item.href} key={item.href} className={activePath === item.href ? "active" : ""} onClick={() => setMobileOpen(false)}><Icon/><span>{item.label}</span>{activePath === item.href && <i/>}</Link>;
          })}
        </nav>
        <div className="sidebarStatus"><span className="statusPulse"/><div><strong>ReelOps conectado</strong><small>Sessão protegida</small></div></div>
        <div className="sidebarAccount">
          <div className="tenantAvatar">{props.tenantName.slice(0, 1).toUpperCase()}</div>
          <div className="tenantInfo"><strong>{props.tenantName}</strong><small>{props.tenantPlan === "starter" ? "Plano Starter" : props.tenantPlan} · {props.role}</small></div>
          {props.memberships.length > 1 && <div className="tenantSwitcher"><select aria-label="Trocar organização" value={props.activeTenantId} disabled={switching} onChange={(event) => switchTenant(event.target.value)}>{props.memberships.map((membership) => <option key={membership.tenantId} value={membership.tenantId}>{membership.name}</option>)}</select><ChevronDown/></div>}
        </div>
        <button className="signOutButton" onClick={signOut}><LogOut/> Sair da conta</button>
      </aside>
      {mobileOpen && <button className="sidebarBackdrop" aria-label="Fechar menu" onClick={() => setMobileOpen(false)}/>}
      <div className="appMain">
        <header className="topbar">
          <button className="menuButton" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu/></button>
          <div className="pageHeading"><span className="eyebrow">{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.description}</p></div>
          <div className="userChip"><span>{props.userEmail.slice(0, 1).toUpperCase()}</span><div><strong>{props.userEmail.split("@")[0]}</strong><small>{props.userEmail}</small></div></div>
        </header>
        <main className="pageContent">{props.children}</main>
      </div>
      <nav className="mobileNav" aria-label="Navegação móvel">{navigation.slice(0,4).map((item) => { const Icon=item.icon; return <Link key={item.href} href={item.href} className={activePath===item.href?"active":""}><Icon/><span>{item.label.replace("Meus ","")}</span></Link> })}<button onClick={()=>setMobileOpen(true)}><Menu/><span>Mais</span></button></nav>
    </div>
  );
}
