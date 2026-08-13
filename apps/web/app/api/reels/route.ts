import { NextResponse } from "next/server";
import { requireContext } from "@/lib/supabase";
export async function GET(request: Request) {
  try {
    const { supabase, tenantId } = await requireContext();
    const url = new URL(request.url); const status = url.searchParams.get("status");
    let query = supabase.from("reels").select("*, restaurants(name), moments(occurred_at,label)").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50);
    if (status && status !== "all") query = query.eq("status", status);
    const { data, error } = await query; if (error) throw error;
    return NextResponse.json({ reels: data });
  } catch { return NextResponse.json({ error: "Não autorizado" }, { status: 401 }); }
}
