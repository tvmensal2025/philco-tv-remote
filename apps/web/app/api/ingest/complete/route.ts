import { NextResponse } from "next/server";
import { ingestCompleteSchema } from "@reelops/shared";
import { adminClient } from "@/lib/supabase";
import { ensureStorage } from "@/lib/storage";
import { getServerEnv } from "@/lib/env";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    if (request.headers.get("authorization") !== `Bearer ${env.INGEST_API_KEY}`) return NextResponse.json({ error: "Chave de ingestão inválida." }, { status: 401 });
    const input = ingestCompleteSchema.parse(await request.json());
    await enforceRateLimit(`ingest-complete:${input.cameraId}`, 30, 60);
    const admin = adminClient();
    const { data: camera } = await admin.from("cameras").select("id,tenant_id,restaurant_id,position").eq("id", input.cameraId).eq("enabled", true).single();
    if (!camera) return NextResponse.json({ error: "Câmera não encontrada." }, { status: 404 });
    const prefix = `raw/${camera.tenant_id}/${camera.restaurant_id}/camera-${camera.position}/`;
    if (!input.objectPath.startsWith(prefix)) return NextResponse.json({ error: "Caminho inválido." }, { status: 403 });
    const { storage, bucket } = await ensureStorage();
    const stat = await storage.statObject(bucket, input.objectPath);
    if (!stat.size) return NextResponse.json({ error: "Upload vazio." }, { status: 409 });
    if (stat.size !== input.expectedBytes || stat.size > env.MAX_SEGMENT_BYTES) {
      await storage.removeObject(bucket, input.objectPath);
      return NextResponse.json({ error: "Segmento inválido ou acima do limite permitido." }, { status: 413 });
    }
    const { error } = await admin.from("cameras").update({ last_seen_at: input.capturedAt, last_segment_path: input.objectPath }).eq("id", camera.id).eq("tenant_id", camera.tenant_id);
    if (error) throw error;
    return NextResponse.json({ ok: true, size: stat.size });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível confirmar o upload." }, { status: 400 });
  }
}
