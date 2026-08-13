import { NextResponse } from "next/server";
import { ingestPresignSchema } from "@reelops/shared";
import { adminClient } from "@/lib/supabase";
import { ensureStorage } from "@/lib/storage";
import { getServerEnv } from "@/lib/env";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    const authorization = request.headers.get("authorization");
    if (authorization !== `Bearer ${env.INGEST_API_KEY}`) return NextResponse.json({ error: "Chave de ingestão inválida." }, { status: 401 });
    const input = ingestPresignSchema.parse(await request.json());
    const capturedAt = new Date(input.capturedAt);
    if (Math.abs(Date.now() - capturedAt.getTime()) > 24 * 60 * 60 * 1000) return NextResponse.json({ error: "Timestamp do segmento fora da janela permitida." }, { status: 422 });
    await enforceRateLimit(`ingest:${input.restaurantId}:${input.cameraPosition}`, 30, 60);
    const admin = adminClient();
    const { data: camera } = await admin.from("cameras").select("id,tenant_id,restaurant_id,position,storage_prefix,enabled").eq("restaurant_id", input.restaurantId).eq("position", input.cameraPosition).eq("enabled", true).single();
    if (!camera) return NextResponse.json({ error: "Câmera não encontrada." }, { status: 404 });
    const canonicalPrefix = `raw/${camera.tenant_id}/${camera.restaurant_id}/camera-${camera.position}`;
    if (camera.storage_prefix !== canonicalPrefix) return NextResponse.json({ error: "Prefixo da câmera não é canônico." }, { status: 409 });
    const day = capturedAt.toISOString().slice(0, 10).replaceAll("-", "/");
    const objectPath = `${canonicalPrefix}/${day}/${capturedAt.toISOString()}.mp4`;
    const { storage, bucket } = await ensureStorage();
    const uploadUrl = await storage.presignedPutObject(bucket, objectPath, 10 * 60);
    return NextResponse.json({ uploadUrl, objectPath, cameraId: camera.id, expiresIn: 600, completeUrl: `${env.APP_URL}/api/ingest/complete` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha na ingestão." }, { status: 400 });
  }
}
