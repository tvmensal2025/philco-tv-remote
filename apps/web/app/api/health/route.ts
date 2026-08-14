import { NextResponse } from 'next/server';
import { collectHealthChecks } from '@/lib/health-checks';
import { isCoreConfigured } from '@/lib/env';
import { requireContext } from '@/lib/supabase';

export async function GET() {
  if (!isCoreConfigured())
    return NextResponse.json(
      { status: 'configuration_required', configured: false },
      { status: 503 },
    );
  try {
    await requireContext();
  } catch {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }
  const payload = await collectHealthChecks();
  return NextResponse.json(payload, { status: payload.status === 'healthy' ? 200 : 503 });
}
