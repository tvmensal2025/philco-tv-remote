"use client";

import { createBrowserClient } from "@supabase/ssr";
import { ArrowRight, Check, Clock3, Clapperboard, Download, Film, Play, RefreshCw, Share2, Sparkles, Trash2, Video, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Restaurant = { id: string; name: string; timezone: string; settings: Record<string, unknown> };
type Reel = { id: string; status: string; progress: number; title: string | null; output_path: string | null; thumbnail_path: string | null; duration_seconds: number | null; score: number | null; created_at: string; restaurants: { name: string } | null; moments: { occurred_at: string; label: string | null } | null };
type Camera = { id: string; restaurant_id: string; last_seen_at: string | null; enabled: boolean };

const statusLabel: Record<string, string> = { queued: "Na fila", collecting: "Coletando", analyzing: "Analisando", rendering: "Renderizando", uploading: "Enviando", ready: "Pronto", approved: "Aprovado", publishing: "Publicando", published: "Publicado", discarded: "Descartado", failed: "Falhou" };
const terminal = ["ready", "approved", "published", "discarded", "failed"];

export default function DashboardOverview({ initialReels, restaurants, cameras, role, runtimeConfig, instagramEnabled }: { initialReels: Reel[]; restaurants: Restaurant[]; cameras: Camera[]; role: string; runtimeConfig: { supabaseUrl: string; supabaseAnonKey: string }; instagramEnabled: boolean }) {
  const [reels, setReels] = useState(initialReels);
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<Reel | null>(null);
  const supabase = useMemo(() => createBrowserClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey), [runtimeConfig]);
  const canEdit = role !== "viewer";

  async function refresh() { const response = await fetch("/api/reels", { cache: "no-store" }); if (response.ok) setReels((await response.json()).reels); }
  useEffect(() => { const channel = supabase.channel("reels-overview").on("postgres_changes", { event: "*", schema: "public", table: "reels" }, refresh).subscribe(); return () => { void supabase.removeChannel(channel); }; }, [supabase]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); }, [toast]);

  async function mark() {
    if (!restaurantId || busy) return;
    setBusy(true);
    const response = await fetch("/api/moments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ restaurantId }) });
    const result = await response.json();
    setBusy(false);
    setToast(response.ok ? "Momento marcado. Assim que o segmento fechar, começaremos a edição." : result.error ?? "Não foi possível marcar o momento.");
    if (response.ok) await refresh();
  }

  async function action(id: string, actionName: "approve" | "discard" | "retry" | "publish") {
    if (actionBusy) return;
    if (actionName === "discard" && !confirm("Descartar este Reel? Ele continuará armazenado até a política de retenção removê-lo.")) return;
    setActionBusy(`${id}:${actionName}`);
    const response = await fetch(`/api/reels/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: actionName }) });
    const result = await response.json();
    setToast(response.ok ? (actionName === "approve" ? "Reel aprovado." : actionName === "discard" ? "Reel descartado." : actionName === "publish" ? "Publicação enviada ao Instagram." : "Reprocessamento enviado.") : result.error);
    setActionBusy(null);
    await refresh();
  }

  const selectedCameras = cameras.filter((camera) => camera.restaurant_id === restaurantId && camera.enabled);
  const onlineCameras = selectedCameras.filter((camera) => camera.last_seen_at && Date.now() - Date.parse(camera.last_seen_at) < 120_000).length;
  const active = reels.filter((reel) => !terminal.includes(reel.status)).length;
  const ready = reels.filter((reel) => ["ready", "approved"].includes(reel.status)).length;
  const published = reels.filter((reel) => reel.status === "published").length;

  return <>
    <section className="captureHero">
      <div className="captureCopy">
        <span className={`captureSignal ${onlineCameras === selectedCameras.length && selectedCameras.length ? "online" : "warning"}`}><i/> {onlineCameras}/{selectedCameras.length || 4} câmeras com sinal recente</span>
        <h2>Um clique. Quatro ângulos.<br/><em>Um Reel memorável.</em></h2>
        <p>Viu um momento especial? Marque agora e o ReelOps recupera os segundos ao redor para criar seu conteúdo.</p>
        <div className="captureControls"><label><span>Restaurante</span><select value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)}>{restaurants.map((restaurant) => <option value={restaurant.id} key={restaurant.id}>{restaurant.name}</option>)}</select></label><button className="momentButton" disabled={busy || !restaurantId || !canEdit} onClick={mark}><span><Zap/></span>{busy ? "Marcando…" : "Marcar Momento"}</button></div>
        {!canEdit && <small className="permissionHint">Seu perfil é somente leitura.</small>}
      </div>
      <div className="captureArt"><div className="cameraOrbit"><span className="orbitDot one"/><span className="orbitDot two"/><span className="orbitDot three"/><span className="orbitDot four"/><div className="orbitCore"><Zap/></div></div></div>
    </section>

    <section className="metricGrid">
      <article className="metricCard"><span className="metricIcon amber"><Clock3/></span><div><small>EM PROCESSAMENTO</small><strong>{active}</strong><p>{active ? "A inteligência está trabalhando" : "Fila livre neste momento"}</p></div><span className="metricTrend">Agora</span></article>
      <article className="metricCard"><span className="metricIcon green"><Check/></span><div><small>PRONTOS PARA REVISAR</small><strong>{ready}</strong><p>{ready ? "Esperando sua aprovação" : "Tudo revisado por aqui"}</p></div><Link href="/reels">Revisar <ArrowRight/></Link></article>
      <article className="metricCard"><span className="metricIcon violet"><Clapperboard/></span><div><small>REELS FINALIZADOS</small><strong>{published}</strong><p>Conteúdos marcados como publicados</p></div><Link href="/reels">Ver todos <ArrowRight/></Link></article>
    </section>

    <section className="recentSection">
      <div className="sectionTitle"><div><span className="kicker">ÚLTIMAS CRIAÇÕES</span><h2>Reels recentes</h2><p>Acompanhe o processamento e revise seus melhores momentos.</p></div><Link href="/reels" className="textLink">Ver biblioteca <ArrowRight/></Link></div>
      {!reels.length ? <div className="premiumEmpty"><span><Film/></span><h3>Seu primeiro Reel começa com um momento</h3><p>Assim que suas câmeras enviarem segmentos, use o botão acima. O restante é automático.</p><Link href="/cameras" className="secondaryButton"><Video/> Configurar câmeras</Link></div> : <div className="reelGrid">{reels.slice(0, 6).map((reel) => <ReelCard key={reel.id} reel={reel} canEdit={canEdit} busy={actionBusy} onAction={action} onOpen={() => setSelected(reel)} instagramEnabled={instagramEnabled} />)}</div>}
    </section>
    {selected && <ReelModal reel={selected} onClose={() => setSelected(null)} />}
    {toast && <div className="toast" role="status" aria-live="polite"><span>{toast}</span><button aria-label="Fechar aviso" onClick={() => setToast("")}>×</button></div>}
  </>;
}

function ReelCard({ reel, canEdit, busy, onAction, onOpen, instagramEnabled }: { reel: Reel; canEdit: boolean; busy: string | null; onAction: (id: string, action: "approve" | "discard" | "retry" | "publish") => void; onOpen: () => void; instagramEnabled: boolean }) {
  const processing = !terminal.includes(reel.status);
  return <article className="reelCard"><button className="reelPreview" onClick={reel.output_path ? onOpen : undefined} aria-label={reel.output_path ? `Assistir ${reel.title}` : undefined} style={reel.thumbnail_path ? { backgroundImage: `url(/api/media/${reel.id}?type=thumbnail)` } : undefined}><span className={`statusBadge ${reel.status}`}><i/>{statusLabel[reel.status] ?? reel.status}</span>{reel.score && <span className="scoreBadge"><Sparkles/> {Math.round(reel.score)}</span>}{reel.duration_seconds && <small className="durationBadge">{Math.round(reel.duration_seconds)}s</small>}{reel.output_path && <span className="playButton"><Play fill="currentColor"/></span>}{processing && <div className="processingLayer"><span className="processingIcon"><Sparkles/></span><strong>{statusLabel[reel.status]}</strong><div className="progressTrack"><i style={{ width: `${reel.progress}%` }}/></div><small>{reel.progress}% concluído</small></div>}</button><div className="reelBody"><h3>{reel.title || reel.moments?.label || "Momento especial"}</h3><p>{reel.restaurants?.name} <span>•</span> {new Date(reel.moments?.occurred_at ?? reel.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>{reel.status === "ready" && canEdit && <div className="cardActions"><button disabled={Boolean(busy)} onClick={() => onAction(reel.id, "approve")}><Check/> Aprovar</button><a href={`/api/media/${reel.id}?download=1`}><Download/> Exportar</a><button className="dangerIcon" disabled={Boolean(busy)} onClick={() => onAction(reel.id, "discard")} aria-label="Descartar Reel"><Trash2/></button></div>}{reel.status === "approved" && <div className="cardActions"><a className="accentAction" href={`/api/media/${reel.id}?download=1`}><Download/> Exportar</a>{instagramEnabled && canEdit && <button className="instagramAction" disabled={Boolean(busy)} onClick={() => onAction(reel.id, "publish")}><Share2/> Publicar</button>}<button className="dangerIcon" disabled={!canEdit || Boolean(busy)} onClick={() => onAction(reel.id, "discard")} aria-label="Descartar Reel"><Trash2/></button></div>}{reel.status === "failed" && canEdit && <button className="retryButton" disabled={Boolean(busy)} onClick={() => onAction(reel.id, "retry")}><RefreshCw/> Tentar novamente</button>}</div></article>;
}

function ReelModal({ reel, onClose }: { reel: Reel; onClose: () => void }) {
  return <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label={`Reel ${reel.title}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="reelModal"><button className="modalClose" onClick={onClose} aria-label="Fechar">×</button><div className="phoneFrame"><video controls autoPlay playsInline src={`/api/media/${reel.id}`} poster={`/api/media/${reel.id}?type=thumbnail`}/></div><div className="modalInfo"><span className="kicker">PRÉVIA DO REEL</span><h2>{reel.title}</h2><p>{reel.restaurants?.name}</p><div className="modalStats"><span><strong>{Math.round(reel.duration_seconds ?? 0)}s</strong>Duração</span><span><strong>{Math.round(reel.score ?? 0)}</strong>ReelScore</span><span><strong>9:16</strong>Formato</span></div><a href={`/api/media/${reel.id}?download=1`} className="primaryButton"><Download/> Baixar MP4</a></div></div></div>;
}
