import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

export function publicApiError(
  code: string,
  message: string,
  status: number,
  requestId = randomUUID(),
) {
  return NextResponse.json({ code, message, requestId }, { status });
}
