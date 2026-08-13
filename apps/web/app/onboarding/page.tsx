import { redirect } from "next/navigation";
import { getPublicRuntimeConfig, isCoreConfigured } from "@/lib/env";
import { userClient } from "@/lib/supabase";
import OnboardingForm from "@/components/onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  if (!isCoreConfigured()) redirect("/setup");
  const supabase = await userClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("tenant_members").select("tenant_id").limit(1).maybeSingle();
  if (membership) redirect("/");
  return <OnboardingForm email={user.email ?? ""} config={getPublicRuntimeConfig()} />;
}
