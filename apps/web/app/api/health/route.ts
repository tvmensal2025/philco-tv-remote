import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase";
import { ensureStorage } from "@/lib/storage";
import { getConfigItems, isCoreConfigured, getServerEnv } from "@/lib/env";
import { Redis } from "ioredis";
import { requireContext } from "@/lib/supabase";

export async function GET() {
  if (!isCoreConfigured()) return NextResponse.json({ status: "configuration_required", configured: false }, { status: 503 });
  try { await requireContext(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 401 }); }
  const env = getServerEnv();
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  try { const { error } = await adminClient().from("tenants").select("id", { head: true, count: "exact" }).limit(1); checks.supabase = { ok: !error, detail: error?.message }; } catch (error) { checks.supabase = { ok: false, detail: error instanceof Error ? error.message : "Erro" }; }
  try { await ensureStorage(); checks.storage = { ok: true, detail: env.MINIO_BUCKET }; } catch (error) { checks.storage = { ok: false, detail: error instanceof Error ? error.message : "Erro" }; }
  let redis: Redis | undefined;
  try { redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2500 }); await redis.connect(); checks.redis = { ok: (await redis.ping()) === "PONG" }; } catch (error) { checks.redis = { ok: false, detail: error instanceof Error ? error.message : "Erro" }; } finally { redis?.disconnect(); }
  try { const { data } = await adminClient().from("worker_nodes").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1).maybeSingle(); const age = data ? Date.now() - Date.parse(data.last_seen_at) : Infinity; checks.worker = { ok: age < 90_000, detail: data?.last_seen_at ?? "Nenhum heartbeat" }; } catch (error) { checks.worker = { ok: false, detail: error instanceof Error ? error.message : "Erro" }; }
  const ok = Object.values(checks).every((check) => check.ok);
  return NextResponse.json({ status: ok ? "healthy" : "degraded", configured: true, checks, config: getConfigItems().map(({ key, configured, required }) => ({ key, configured, required })) }, { status: ok ? 200 : 503 });
}
