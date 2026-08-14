import { NextResponse } from 'next/server';
import { isCoreConfigured } from '@/lib/env';

/** Process is up and can accept HTTP traffic. Dependency checks live on GET /api/health. */
export function GET() {
  return NextResponse.json({
    ready: true,
    configured: isCoreConfigured(),
    role: 'traffic',
  });
}
