import { NextResponse } from "next/server";
import { onboardingSchema } from "@reelops/shared";
import { userClient } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const input = onboardingSchema.parse(await request.json());
    const supabase = await userClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const { data, error } = await supabase.rpc("onboard_tenant", {
      organization_name: input.organizationName,
      restaurant_name: input.restaurantName,
      user_timezone: input.timezone
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao criar operação." }, { status: 400 });
  }
}
