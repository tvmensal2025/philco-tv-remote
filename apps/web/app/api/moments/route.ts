import { NextResponse } from "next/server";
import { markMomentSchema } from "@reelops/shared";
import { requireContext, requireRole, adminClient } from "@/lib/supabase";
import { videoQueue } from "@/lib/queue";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ["owner", "admin", "editor"]);
    await enforceRateLimit(`moments:${ctx.tenantId}:${ctx.user.id}`, 10, 60);
    const input = markMomentSchema.parse(await request.json());
    const { data: restaurant } = await ctx.supabase
      .from("restaurants")
      .select("id,settings")
      .eq("id", input.restaurantId)
      .eq("tenant_id", ctx.tenantId)
      .single();
    if (!restaurant) return NextResponse.json({ error: "Restaurante não encontrado." }, { status: 404 });

    const settings = (restaurant.settings ?? {}) as Record<string, unknown>;
    const occurredAt = new Date(input.occurredAt ?? Date.now());
    const before = input.beforeSeconds ?? Number(settings.window_before ?? 12);
    const after = input.afterSeconds ?? Number(settings.window_after ?? 8);
    const windowStart = new Date(occurredAt.getTime() - before * 1000);
    const windowEnd = new Date(occurredAt.getTime() + after * 1000);
    const admin = adminClient();

    const { data: moment, error: momentError } = await admin.from("moments").insert({
      tenant_id: ctx.tenantId,
      restaurant_id: input.restaurantId,
      created_by: ctx.user.id,
      occurred_at: occurredAt.toISOString(),
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      label: input.label
    }).select().single();
    if (momentError) throw momentError;

    const { data: reel, error: reelError } = await admin.from("reels").insert({
      tenant_id: ctx.tenantId,
      restaurant_id: input.restaurantId,
      moment_id: moment.id,
      title: input.label || "Momento especial"
    }).select().single();
    if (reelError) {
      await admin.from("moments").delete().eq("id", moment.id).eq("tenant_id", ctx.tenantId);
      throw reelError;
    }

    await admin.from("job_events").insert({ tenant_id: ctx.tenantId, reel_id: reel.id, status: "queued", message: "Momento recebido" });
    const payload = {
      jobId: reel.id,
      tenantId: ctx.tenantId,
      restaurantId: input.restaurantId,
      momentId: moment.id,
      reelId: reel.id,
      occurredAt: occurredAt.toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString()
    };
    const delay = Math.max(0, windowEnd.getTime() + 15_000 - Date.now());
    try {
      await videoQueue().add("render-reel", payload, {
        jobId: reel.id,
        delay,
        attempts: 8,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 5000 }
      });
    } catch (queueError) {
      await admin.from("reels").update({ status: "failed", error_code: "QUEUE_UNAVAILABLE", error_message: "A fila está indisponível. Tente novamente." }).eq("id", reel.id).eq("tenant_id", ctx.tenantId);
      throw queueError;
    }
    return NextResponse.json({ moment, reel }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: status === 403 ? "Seu perfil não pode marcar momentos." : message }, { status });
  }
}
