"use client";

import { Check, Film, Gauge, Sparkles, WandSparkles } from "lucide-react";
import { useState } from "react";

const options = [
  { id: "natural", title: "Natural", tag: "Recomendado", description: "Cortes suaves que preservam a atmosfera real do restaurante.", color: "forest", cut: "Cortes naturais", rhythm: "Ritmo equilibrado" },
  { id: "dynamic", title: "Dinâmico", tag: "Mais energia", description: "Trocas rápidas de câmera, ritmo forte e foco em ação.", color: "citrus", cut: "Cortes rápidos", rhythm: "Ritmo intenso" },
  { id: "cinematic", title: "Cinematográfico", tag: "Premium", description: "Ritmo elegante, planos mais longos e presença visual sofisticada.", color: "midnight", cut: "Planos elegantes", rhythm: "Ritmo suave" }
] as const;

type Restaurant = { id: string; name: string; timezone: string; settings: Record<string, unknown> };

export default function StylesManager({ restaurants, role }: { restaurants: Restaurant[]; role: string }) {
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? "");
  const restaurant = restaurants.find((item) => item.id === restaurantId);
  const [activeByRestaurant, setActiveByRestaurant] = useState<Record<string, string>>(() => Object.fromEntries(restaurants.map((item) => [item.id, String(item.settings.active_style ?? "natural")])));
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const canEdit = ["owner", "admin"].includes(role);
  const active = activeByRestaurant[restaurantId] ?? "natural";

  async function select(style: typeof options[number]["id"]) {
    if (!restaurant || !canEdit || saving) return;
    setSaving(style);
    const response = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ restaurantId: restaurant.id, name: restaurant.name, timezone: restaurant.timezone, windowBefore: Number(restaurant.settings.window_before ?? 12), windowAfter: Number(restaurant.settings.window_after ?? 8), activeStyle: style }) });
    const data = await response.json();
    setSaving("");
    if (response.ok) { setActiveByRestaurant((current) => ({ ...current, [restaurantId]: style })); setMessage(`Estilo ${options.find((item) => item.id === style)?.title} ativado.`); }
    else setMessage(data.error);
  }

  return <section className="stylesPage"><div className="creativeIntro"><div><span className="kicker"><WandSparkles/> MOTOR DE EDIÇÃO</span><h2>Escolha o ritmo da sua história.</h2><p>O estilo selecionado orienta a escolha de câmeras, velocidade dos cortes e tratamento visual dos próximos Reels.</p></div><label className="selectLabel"><span>Restaurante</span><select value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)}>{restaurants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="styleGrid">{options.map((style)=><article key={style.id} className={`styleCard ${style.color} ${active===style.id?"selected":""}`}><div className="stylePreview"><div className="fakeReel"><span/><span/><span/></div><i className="styleGlow"/></div><div className="styleBody"><span className="styleTag">{style.tag}</span><h2>{style.title}</h2><p>{style.description}</p><div className="styleTraits"><span><Film/> {style.cut}</span><span><Gauge/> {style.rhythm}</span></div><button disabled={!canEdit || Boolean(saving)} className={active===style.id?"selectedStyle":"secondaryButton"} onClick={()=>select(style.id)}>{active===style.id?<><Check/> Estilo ativo</>:saving===style.id?"Salvando…":"Selecionar estilo"}</button></div></article>)}</div><div className="comingBanner"><span><Sparkles/></span><div><strong>Em breve: estilos personalizados com sua marca</strong><p>Logo, trilha, tipografia e cores aplicados automaticamente a cada Reel.</p></div></div>{message&&<div className="toast" role="status"><span>{message}</span><button onClick={()=>setMessage("")}>×</button></div>}</section>;
}
