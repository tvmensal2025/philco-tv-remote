import { NextResponse } from 'next/server';
import { adobeCloudEvents, adobeJobFromEvent, adobeWebhookChallenge } from '@reelops/shared';

export const dynamic = 'force-dynamic';

function challengeResponse(challenge: string) {
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const challenge = adobeWebhookChallenge({ searchParams: url.searchParams });
  if (challenge) return challengeResponse(challenge);
  return NextResponse.json({
    ok: true,
    service: 'adobe-dgr-events',
    webhook: '/api/adobe/events',
  });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const raw = await request.text();
  let body: unknown = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
  }
  const challenge = adobeWebhookChallenge({ searchParams: url.searchParams, body });
  if (challenge) return challengeResponse(challenge);

  const expected = process.env.ADOBE_CLIENT_ID?.trim();
  const jobs = adobeCloudEvents(body).map(adobeJobFromEvent);
  if (expected) {
    const mismatch = jobs.find(
      (job) => job.recipientClientId && job.recipientClientId !== expected,
    );
    if (mismatch) {
      return NextResponse.json({ error: 'recipient mismatch' }, { status: 401 });
    }
  }
  return NextResponse.json({ ok: true, received: jobs.length, jobs });
}
