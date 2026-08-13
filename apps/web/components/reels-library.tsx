"use client";

import { Check, Clock3, Download, Film, Play, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

type Reel = { id: string; status: string; title: string | null; output_path: string | null; thumbnail_path: string | null; duration_seconds: number | null; score: number | null; created_at: string; restaurants: { name: string } | null; moments: { occurred_at: string; label: string | null } | null };
type Filter = "all" | "ready" | "approved" | "published";
const labels: Record<string, string> = { ready: "Para revisar", approved: "Aprovado", published: "Publicado", failed: "Com erro", queued: "Na fila", rendering: "Renderizando", analyzing: "Analisando", uploading: "Enviando", collecting: "Coletando", publishing: "Publicando" };

export default function ReelsLibrary({ reels }: { reels: Reel[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => reels.filter((reel) => {
    const matchesFilter = filter === "all" || reel.status === filter;
    const haystack = `${reel.title ?? ""} ${reel.restaurants?.name ?? ""}`.toLocaleLowerCase("pt-BR");
    return matchesFilter && haystack.includes(query.trim().toLocaleLowerCase("pt-BR"));
  }), [reels, query, filter]);

  return <section className="libraryPage">
    <div className="libraryToolbar"><label className="searchBox"><Search/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por título ou restaurante" aria-label="Buscar Reels"/></label><div className="filterPills">{(["all","ready","approved","published"] as Filter[]).map((item) => <button key={item} className={filter===item?"active":""} onClick={() => setFilter(item)}>{item === "all" ? "Todos" : item === "ready" ? "Para revisar" : item === "approved" ? "Aprovados" : "Publicados"} <span>{item === "all" ? reels.length : reels.filter((reel) => reel.status === item).length}</span></button>)}</div></div>
    {!shown.length ? <div className="premiumEmpty"><span><Film/></span><h3>{reels.length ? "Nenhum Reel corresponde à busca" : "Sua biblioteca está pronta para ganhar vida"}</h3><p>{reels.length ? "Ajuste a busca ou selecione outro status." : "Os Reels concluídos aparecerão aqui para revisão e exportação."}</p></div> : <div className="libraryGrid">{shown.map((reel) => <article className="libraryCard" key={reel.id}><a className="libraryPreview" href={reel.output_path ? `/api/media/${reel.id}` : undefined} style={reel.thumbnail_path ? { backgroundImage: `url(/api/media/${reel.id}?type=thumbnail)` } : undefined}><span className={`statusBadge ${reel.status}`}><i/>{labels[reel.status] ?? reel.status}</span>{reel.score && <span className="scoreBadge"><Sparkles/> {Math.round(reel.score)}</span>}{reel.output_path && <span className="playButton"><Play fill="currentColor"/></span>}</a><div className="libraryBody"><h2>{reel.title ?? "Momento especial"}</h2><p>{reel.restaurants?.name} · {new Date(reel.moments?.occurred_at ?? reel.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}</p><div className="libraryMeta"><span><Clock3/> {Math.round(reel.duration_seconds ?? 0)} segundos</span><span><Check/> Vertical 9:16</span></div>{reel.output_path && <a className="secondaryButton full" href={`/api/media/${reel.id}?download=1`}><Download/> Exportar MP4</a>}</div></article>)}</div>}
  </section>;
}
