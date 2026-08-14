import { NextResponse } from 'next/server';
import { collectHealthChecks } from '@/lib/health-checks';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { adminError } from '@/lib/admin-error';
import { isCoreConfigured } from '@/lib/env';

export async function GET() {
  try {
    await requirePlatformAdmin();
    if (!isCoreConfigured())
      return NextResponse.json(
        { status: 'configuration_required', configured: false },
        { status: 503 },
      );
    const payload = await collectHealthChecks();
    return NextResponse.json(payload, { status: payload.status === 'healthy' ? 200 : 503 });
  } catch (error) {
    return adminError(error);
  }
}
