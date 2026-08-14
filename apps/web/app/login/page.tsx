import { redirect } from 'next/navigation';
import { isAuthBypass, isCoreConfigured, getPublicRuntimeConfig } from '@/lib/env';
import LoginForm from '@/components/login-form';
import ConfigurationRequired from '@/components/configuration-required';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isCoreConfigured()) return <ConfigurationRequired />;
  if (isAuthBypass()) redirect('/');
  const config = getPublicRuntimeConfig();
  const { error } = await searchParams;
  return <LoginForm config={config} invalidLink={error === 'link-invalido'} />;
}
