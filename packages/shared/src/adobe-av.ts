export const ADOBE_IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
export const ADOBE_AV_API_BASE = 'https://audio-video-api.adobe.io';
export const ADOBE_IMS_SCOPES = 'openid,AdobeID,firefly_api,ff_apis';
export const ADOBE_VERTICAL_PRESET = 'ffs_video_api_vert_1920p_hq';
export const ADOBE_PRORES_PRESET = 'ffs_video_api_prores';

export type AdobeCredentials = {
  clientId: string;
  clientSecret: string;
  scopes?: string;
};

export function adobeCredentialsReady(input: {
  clientId?: string | null;
  clientSecret?: string | null;
}) {
  return Boolean(input.clientId?.trim() && input.clientSecret?.trim());
}

export function adobeWebhookUrl(appUrl: string) {
  return `${appUrl.replace(/\/$/, '')}/api/adobe/events`;
}

export function adobeWebhookChallenge(input: {
  searchParams: URLSearchParams;
  body?: unknown;
}): string | null {
  const fromQuery = input.searchParams.get('challenge')?.trim();
  if (fromQuery) return fromQuery;
  if (input.body && typeof input.body === 'object') {
    const challenge = (input.body as { challenge?: unknown }).challenge;
    if (typeof challenge === 'string' && challenge.trim()) return challenge.trim();
  }
  return null;
}

export type AdobeCloudEvent = {
  id?: string;
  type?: string;
  recipientclientid?: string;
  data?: {
    source?: string;
    value?: {
      job_id?: string;
      jobId?: string;
      status?: string;
      status_url?: string;
      statusUrl?: string;
    };
  };
};

export function adobeCloudEvents(body: unknown): AdobeCloudEvent[] {
  if (Array.isArray(body)) return body.filter((item) => item && typeof item === 'object');
  if (body && typeof body === 'object') return [body as AdobeCloudEvent];
  return [];
}

export function adobeJobFromEvent(event: AdobeCloudEvent) {
  const value = event.data?.value ?? {};
  return {
    eventId: event.id ?? null,
    type: event.type ?? null,
    jobId: value.job_id ?? value.jobId ?? null,
    status: value.status ?? null,
    statusUrl: value.status_url ?? value.statusUrl ?? null,
    recipientClientId: event.recipientclientid ?? null,
  };
}

export async function fetchAdobeAccessToken(
  credentials: AdobeCredentials,
  io: { fetch?: typeof fetch } = {},
) {
  const send = io.fetch ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope: credentials.scopes ?? ADOBE_IMS_SCOPES,
  });
  const response = await send(ADOBE_IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ADOBE_TOKEN_${response.status}:${text.slice(0, 180)}`);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('ADOBE_TOKEN_MISSING');
  return {
    accessToken: json.access_token,
    expiresInSec: json.expires_in ?? 86_400,
  };
}

export function adobeAvHeaders(clientId: string, accessToken: string, orgId?: string | null) {
  return {
    authorization: `Bearer ${accessToken}`,
    'x-api-key': clientId,
    'content-type': 'application/json',
    ...(orgId ? { 'x-gw-ims-org-id': orgId } : {}),
  };
}

export type AdobeDgrControl = {
  variableId: string;
  label?: string;
  type?: string;
};

export function dgrTextVariables(
  controls: AdobeDgrControl[],
  copy: { title?: string | null; cta?: string | null; lowerThird?: string | null },
) {
  const pairs: Array<[string[], string]> = [
    [['title', 'titulo', 'headline', 'nome'], copy.title ?? ''],
    [['cta', 'call'], copy.cta ?? ''],
    [['lower', 'subtitle', 'legenda', 'linha'], copy.lowerThird ?? ''],
  ];
  const used = new Set<string>();
  const variables: Array<{ variableId: string; text: string }> = [];
  for (const control of controls) {
    const type = (control.type ?? '').toLowerCase();
    if (type && type !== 'text' && type !== 'string' && !type.includes('text')) continue;
    const label = `${control.label ?? ''} ${control.variableId}`.toLowerCase();
    for (const [needles, value] of pairs) {
      if (!value.trim() || used.has(needles[0]!)) continue;
      if (needles.some((needle) => label.includes(needle))) {
        used.add(needles[0]!);
        variables.push({ variableId: control.variableId, text: value.trim().slice(0, 80) });
        break;
      }
    }
  }
  return variables;
}
