import { NextResponse } from "next/server";
import { cameraUpdateSchema } from "@reelops/shared";
import { adminClient, requireContext, requireRole } from "@/lib/supabase";

export async function PUT(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ["owner", "admin"]);
    const input = cameraUpdateSchema.parse(await request.json());
    const { data: camera } = await ctx.supabase.from("cameras").select("id,tenant_id,restaurant_id,position").eq("id", input.cameraId).eq("tenant_id", ctx.tenantId).single();
    if (!camera) return NextResponse.json({ error: "Câmera não encontrada." }, { status: 404 });
    const canonicalPrefix = `raw/${ctx.tenantId}/${camera.restaurant_id}/camera-${camera.position}`;
    if (input.storagePrefix !== canonicalPrefix) return NextResponse.json({ error: `O caminho seguro desta câmera deve ser ${canonicalPrefix}` }, { status: 409 });
    const { error } = await adminClient().from("cameras").update({ name: input.name, enabled: input.enabled, storage_prefix: canonicalPrefix }).eq("id", input.cameraId).eq("tenant_id", ctx.tenantId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro";
    return NextResponse.json({ error: message === "FORBIDDEN" ? "Apenas administradores podem configurar câmeras." : message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
