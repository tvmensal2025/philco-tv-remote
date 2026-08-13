"use client";

import { CheckCircle2, ChevronRight, CircleAlert, Cloud, Database, ExternalLink, HardDrive, HeartPulse, Info, RefreshCw, Save, Server, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";

type Restaurant = { id: string; name: string; timezone: string; settings: Record<string, unknown> };
type ConfigItem = { key: string; label: string; group: string; configured: boolean; required: boolean; hint: string };
type Health = { status: string; checks?: Record<string, { ok: boolean; detail?: string }> };

export default function SettingsPanel({ restaurants: initial, role, configItems, instagramEnabled }: { restaurants: Restaurant[]; role: string; configItems: ConfigItem[]; instagramEnabled: boolean }) {
  const [restaurants, setRestaurants] = useState(initial);
  const [restaurantId, setRestaurantId] = useState(initial[0]?.id ?? "");
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const canEdit = ["owner", "admin"].includes(role);
  const restaurant = restaurants.find((item) => item.id === restaurantId);

  async function checkHealth() { setChecking(true); const response = await fetch("/api/health", { cache: "no-store" }); setHealth(await response.json()); setChecking(false); }
  useEffect(() => { void checkHealth(); }, []);

  function update(field: string, value: string | number) { setRestaurants((items) => items.map((item) => item.id === restaurantId ? { ...item, ...(field === "name" || field === "timezone" ? { [field]: value } : { settings: { ...item.settings, [field]: value } }) } : item)); }
  async function save() {
    if (!restaurant) return;
    setSaving(true);
    const response = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ restaurantId: restaurant.id, name: restaurant.name, timezone: restaurant.timezone, windowBefore: Number(restaurant.settings.window_before ?? 12), windowAfter: Number(restaurant.settings.window_after ?? 8), activeStyle: restaurant.settings.active_style ?? "natural" }) });
    const data = await response.json(); setSaving(false); setMessage(response.ok ? "Configurações salvas." : data.error);
  }

  const checks = [
    { key: "supabase", label: "Supabase", description: "Banco, autenticação e Realtime", icon: Database },
    { key: "storage", label: "MinIO", description: "Bucket privado de mídia", icon: HardDrive },
    { key: "redis", label: "Redis", description: "Fila de processamento", icon: Server },
    { key: "worker", label: "Worker FFmpeg", description: "Renderização de vídeos", icon: HeartPulse }
  ];

  return <div className="settingsLayout">
    <section className="settingsMain">
      <article className="settingsCard healthCard"><div className="cardHeader"><div><span className="kicker"><HeartPulse/> SAÚDE DO SISTEMA</span><h2>Integrações essenciais</h2><p>Os testes usam as credenciais do servidor sem revelar nenhum segredo.</p></div><button className="secondaryButton" onClick={checkHealth} disabled={checking}><RefreshCw className={checking ? "spin" : ""}/>{checking ? "Testando…" : "Testar conexões"}</button></div><div className="healthGrid">{checks.map((item) => { const Icon = item.icon; const check = health?.checks?.[item.key]; return <div className="healthItem" key={item.key}><span className="healthIcon"><Icon/></span><div><strong>{item.label}</strong><small>{item.description}</small></div><span className={`healthState ${check?.ok ? "ok" : check === undefined ? "pending" : "error"}`}>{check?.ok ? <><CheckCircle2/> Operacional</> : check === undefined ? "Verificando" : <><CircleAlert/> Atenção</>}</span></div>})}</div></article>

      <article className="settingsCard"><div className="cardHeader"><div><span className="kicker"><Settings2/> OPERAÇÃO</span><h2>Restaurante e captura</h2><p>Defina a janela que será recuperada ao marcar um momento.</p></div><label className="compactSelect"><select value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)}>{restaurants.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div>{restaurant && <div className="settingsForm"><label>Nome do restaurante<input disabled={!canEdit} value={restaurant.name} onChange={(event) => update("name", event.target.value)}/></label><label>Fuso horário<select disabled={!canEdit} value={restaurant.timezone} onChange={(event) => update("timezone", event.target.value)}><option value="America/Sao_Paulo">Brasília — São Paulo</option><option value="America/Manaus">Manaus</option><option value="America/Fortaleza">Fortaleza</option><option value="America/Recife">Recife</option></select></label><div className="timeWindow"><label>Segundos antes<input type="number" min="3" max="120" disabled={!canEdit} value={Number(restaurant.settings.window_before ?? 12)} onChange={(event) => update("window_before", Number(event.target.value))}/></label><span className="windowVisual"><i style={{width:`${Math.min(80,Number(restaurant.settings.window_before??12)*2)}px`}}/><b>Momento</b><i style={{width:`${Math.min(80,Number(restaurant.settings.window_after??8)*2)}px`}}/></span><label>Segundos depois<input type="number" min="3" max="120" disabled={!canEdit} value={Number(restaurant.settings.window_after ?? 8)} onChange={(event) => update("window_after", Number(event.target.value))}/></label></div>{canEdit && <button className="primaryButton alignRight" onClick={save} disabled={saving}><Save/>{saving ? "Salvando…" : "Salvar alterações"}</button>}</div>}</article>

      <article className="settingsCard"><div className="cardHeader"><div><span className="kicker"><Cloud/> PUBLICAÇÃO</span><h2>Instagram e exportação</h2><p>O MP4 sempre pode ser exportado. A publicação automática é opcional.</p></div></div><div className="integrationRow"><span className="instagramIcon">◎</span><div><strong>Instagram profissional</strong><small>{instagramEnabled ? "Credenciais detectadas no servidor" : "Preencha META_ACCESS_TOKEN e META_INSTAGRAM_ACCOUNT_ID"}</small></div><span className={`healthState ${instagramEnabled ? "ok" : "pending"}`}>{instagramEnabled ? <><CheckCircle2/> Configurado</> : "Opcional"}</span></div></article>
    </section>

    <aside className="settingsSide">
      <article className="envCard"><span className="kicker">CHECKLIST DO .ENV</span><h2>{configItems.filter((item) => item.configured).length}/{configItems.length}</h2><p>variáveis preenchidas</p><div className="envProgress"><i style={{ width: `${configItems.filter((item) => item.configured).length / configItems.length * 100}%` }}/></div><div className="envList">{configItems.map((item) => <div key={item.key}><span className={item.configured ? "ok" : item.required ? "missing" : "optional"}>{item.configured ? <CheckCircle2/> : <CircleAlert/>}</span><div><strong>{item.label}</strong><code>{item.key}</code></div><ChevronRight/></div>)}</div><a href="/setup" className="secondaryButton full"><ExternalLink/> Ver guia completo</a></article>
      <article className="infoCard"><Info/><div><strong>Segredos protegidos</strong><p>Chaves do MinIO, Redis, Supabase e Meta nunca são enviadas ao navegador.</p></div></article>
    </aside>
    {message && <div className="toast" role="status"><span>{message}</span><button onClick={()=>setMessage("")}>×</button></div>}
  </div>;
}
