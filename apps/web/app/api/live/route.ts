import { NextResponse } from 'next/server';

/** Process is alive. Readiness and dependency checks live on GET /api/ready and GET /api/health. */
export function GET() {
  return NextResponse.json({ live: true, pid: process.pid });
}
