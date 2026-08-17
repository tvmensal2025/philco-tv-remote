import { NextResponse } from 'next/server';
import {
  ADOBE_AV_API_BASE,
  adobeAvHeaders,
  adobeCredentialsReady,
  adobeWebhookUrl,
  fetchAdobeAccessToken,
} from '@reelops/shared';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { adminError } from '@/lib/admin-error';
import { getServerEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requirePlatformAdmin();
    const clientId = process.env.ADOBE_CLIENT_ID?.trim();
    const clientSecret = process.env.ADOBE_CLIENT_SECRET?.trim();
    const env = getServerEnv();
    if (!adobeCredentialsReady({ clientId, clientSecret })) {
      return NextResponse.json({
        ok: false,
        reason: 'not_configured',
        webhookUrl: adobeWebhookUrl(env.APP_URL),
      });
    }
    const token = await fetchAdobeAccessToken({
      clientId: clientId!,
      clientSecret: clientSecret!,
      scopes: process.env.ADOBE_IMS_SCOPE,
    });
    const presets = await fetch(`${ADOBE_AV_API_BASE}/v1/presets`, {
      headers: adobeAvHeaders(clientId!, token.accessToken, process.env.ADOBE_ORG_ID),
    });
    const text = await presets.text();
    if (!presets.ok) {
      return NextResponse.json(
        { ok: false, reason: 'presets_failed', status: presets.status, detail: text.slice(0, 240) },
        { status: 502 },
      );
    }
    const json = text ? JSON.parse(text) : {};
    const list = Array.isArray(json.presets) ? json.presets : Array.isArray(json) ? json : [];
    return NextResponse.json({
      ok: true,
      tokenExpiresInSec: token.expiresInSec,
      presetCount: list.length,
      webhookUrl: adobeWebhookUrl(env.APP_URL),
      mogrtConfigured: Boolean(process.env.ADOBE_MOGRT_URL?.trim()),
    });
  } catch (error) {
    return adminError(error);
  }
}
