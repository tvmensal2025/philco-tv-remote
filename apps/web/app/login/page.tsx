import { redirect } from "next/navigation";
import { isCoreConfigured, getPublicRuntimeConfig } from "@/lib/env";
import LoginForm from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isCoreConfigured()) redirect("/setup");
  const config = getPublicRuntimeConfig();
  const { error } = await searchParams;
  return <LoginForm config={config} invalidLink={error === "link-invalido"} />;
}
