import { CheckCircle2, CircleAlert, Database, HardDrive, KeyRound, Server } from "lucide-react";
import { getConfigItems, isInstallationConfigured } from "@/lib/env";
import Link from "next/link";
import CopyConfigButton from "@/components/copy-config-button";
import { userClient } from "@/lib/supabase";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const items = getConfigItems();
  const ready = isInstallationConfigured();
  const coreReady = items.filter((item) => item.required && item.key !== "SUPABASE_DB_URL").every((item) => item.configured);
  if (coreReady) {
    const supabase = await userClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    const { data: membership } = await supabase.from("tenant_members").select("role").eq("user_id", user.id).in("role", ["owner", "admin"]).limit(1).maybeSingle();
    if (!membership) redirect("/");
  }
  const requiredReady = items.filter((item) => item.required).filter((item) => item.configured).length;
  const requiredTotal = items.filter((item) => item.required).length;
  const groups = [...new Set(items.map((item) => item.group))];

  return (
    <main className="setupPage">
      <div className="setupTop"><div className="authBrand dark"><span className="brandMark">R</span><span>ReelOps</span></div><span className={ready ? "setupPill ready" : "setupPill"}>{ready ? <CheckCircle2 /> : <CircleAlert />} {ready ? "Pronto para iniciar" : `${requiredReady}/${requiredTotal} obrigatórias`}</span></div>
      <section className="setupHero">
        <span className="kicker"><Server size={14}/> Configuração da instalação</span>
        <h1>Falta pouco para colocar<br/>seu ReelOps no ar.</h1>
        <p>Preencha as variáveis abaixo no arquivo <code>.env</code> da VPS. Segredos nunca são exibidos nem armazenados no navegador.</p>
        {ready && <Link href="/login" className="primaryButton">Abrir ReelOps</Link>}
      </section>
      <section className="setupGrid">
        {groups.map((group) => (
          <article className="setupGroup" key={group}>
            <header><span className="setupGroupIcon">{group === "Supabase" ? <Database/> : group === "Armazenamento" ? <HardDrive/> : group === "Fila" ? <Server/> : <KeyRound/>}</span><div><h2>{group}</h2><p>{items.filter((item) => item.group === group && item.configured).length} de {items.filter((item) => item.group === group).length} configuradas</p></div></header>
            <div className="configList">
              {items.filter((item) => item.group === group).map((item) => (
                <div className="configRow" key={item.key}>
                  <span className={item.configured ? "configState ok" : item.required ? "configState missing" : "configState optional"}>{item.configured ? <CheckCircle2/> : <CircleAlert/>}</span>
                  <div><strong>{item.label}{!item.required && <em>Opcional</em>}</strong><code>{item.key}</code><small>{item.hint}</small></div>
                  <CopyConfigButton value={item.key}/>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
      <footer className="setupFooter"><p>Depois de salvar o <code>.env</code>, reinicie os containers. Esta página atualizará o status automaticamente ao recarregar.</p></footer>
    </main>
  );
}
