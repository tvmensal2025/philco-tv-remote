import { NextResponse } from "next/server";
import { restaurantSettingsSchema } from "@reelops/shared";
import { adminClient, requireContext, requireRole } from "@/lib/supabase";

export async function PUT(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ["owner", "admin"]);
    const input = restaurantSettingsSchema.parse(await request.json());
    const { data: current } = await ctx.supabase.from("restaurants").select("id,settings").eq("id", input.restaurantId).eq("tenant_id", ctx.tenantId).single();
    if (!current) return NextResponse.json({ error: "Restaurante não encontrado." }, { status: 404 });
    const settings = { ...(current.settings as object), window_before: input.windowBefore, window_after: input.windowAfter, active_style: input.activeStyle };
    const { error } = await adminClient().from("restaurants").update({ name: input.name, timezone: input.timezone, settings }).eq("id", input.restaurantId).eq("tenant_id", ctx.tenantId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro";
    return NextResponse.json({ error: message === "FORBIDDEN" ? "Apenas administradores podem alterar configurações." : message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
