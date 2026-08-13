"use client";

import { Camera, CheckCircle2, Clock3, Copy, Radio, Save, Signal, SignalLow } from "lucide-react";
import { useState } from "react";

type CameraItem = { id: string; restaurant_id: string; name: string; position: number; enabled: boolean; storage_prefix: string; last_seen_at: string | null; last_segment_path: string | null; source_type: string };
type Restaurant = { id: string; name: string };

export default function CamerasManager({ cameras: initial, restaurants, role }: { cameras: CameraItem[]; restaurants: Restaurant[]; role: string }) {
  const [cameras, setCameras] = useState(initial);
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? "");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const canConfigure = ["owner", "admin"].includes(role);
  const visible = cameras.filter((camera) => camera.restaurant_id === restaurantId);

  function patch(id: string, update: Partial<CameraItem>) { setCameras((items) => items.map((item) => item.id === id ? { ...item, ...update } : item)); }
  async function save(camera: CameraItem) {
    setSaving(camera.id);
    const response = await fetch("/api/cameras", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cameraId: camera.id, name: camera.name, enabled: camera.enabled, storagePrefix: camera.storage_prefix }) });
    const data = await response.json(); setSaving(null); setMessage(response.ok ? `${camera.name} atualizada.` : data.error);
  }

  return <>
    <section className="cameraSummary"><div><span className="kicker"><Radio/> INGESTÃO NVR</span><h2>{visible.filter((camera) => camera.last_seen_at && Date.now() - Date.parse(camera.last_seen_at) < 120_000).length} de {visible.length} câmeras online</h2><p>Uma câmera fica online quando envia um segmento nos últimos dois minutos.</p></div><label className="selectLabel"><span>Restaurante</span><select value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)}>{restaurants.map((restaurant) => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}</select></label></section>
    <section className="cameraGrid">{visible.map((camera) => { const online = Boolean(camera.last_seen_at && Date.now() - Date.parse(camera.last_seen_at) < 120_000); return <article className="cameraCard" key={camera.id}><div className="cameraVisual"><div className="cameraLens"><Camera/></div><span className={`cameraState ${online ? "online" : "offline"}`}>{online ? <Signal/> : <SignalLow/>}{online ? "Online" : camera.last_seen_at ? "Sinal atrasado" : "Aguardando sinal"}</span><span className="cameraNumber">CAM {String(camera.position).padStart(2,"0")}</span></div><div className="cameraForm"><label>Nome da câmera<input value={camera.name} disabled={!canConfigure} onChange={(event) => patch(camera.id, { name: event.target.value })}/></label><label>Caminho seguro<div className="copyField"><code>{camera.storage_prefix}</code><button aria-label="Copiar caminho" onClick={() => navigator.clipboard.writeText(camera.storage_prefix)}><Copy/></button></div></label><div className="cameraDetails"><span><Clock3/> {camera.last_seen_at ? `Último sinal ${new Date(camera.last_seen_at).toLocaleString("pt-BR")}` : "Nenhum segmento recebido"}</span><span><CheckCircle2/> Fonte: {camera.source_type.toUpperCase()}</span></div><div className="cameraFooter"><label className="switch"><input type="checkbox" checked={camera.enabled} disabled={!canConfigure} onChange={(event) => patch(camera.id, { enabled: event.target.checked })}/><span/>Câmera ativa</label>{canConfigure && <button className="saveButton" disabled={saving === camera.id} onClick={() => save(camera)}><Save/>{saving === camera.id ? "Salvando…" : "Salvar"}</button>}</div></div></article>})}</section>
    <section className="ingestHelp"><div className="helpIcon"><Radio/></div><div><h3>Como enviar os segmentos</h3><p>Seu NVR solicita uma URL temporária em <code>POST /api/ingest/presign</code> usando <code>INGEST_API_KEY</code>. ID deste restaurante: <code>{restaurantId}</code> <button className="inlineCopy" onClick={() => navigator.clipboard.writeText(restaurantId)} aria-label="Copiar ID do restaurante"><Copy/></button></p></div></section>
    {message && <div className="toast" role="status"><span>{message}</span><button onClick={()=>setMessage("")}>×</button></div>}
  </>;
}
