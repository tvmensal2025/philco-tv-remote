import {
  ADOBE_AV_API_BASE,
  ADOBE_VERTICAL_PRESET,
  adobeAvHeaders,
  adobeCredentialsReady,
  dgrTextVariables,
  fetchAdobeAccessToken,
  type AdobeCredentials,
  type AdobeDgrControl,
} from '@reelops/shared';
import { writeFile } from 'node:fs/promises';
import { Client } from 'minio';
import { config } from '../config.js';
import { minio } from '../services.js';

type AdobeJobStatus = {
  jobId?: string;
  status?: string;
  statusUrl?: string;
  outputs?: Array<{ url?: string; destination?: { url?: string } }>;
  result?: { outputs?: Array<{ url?: string }> };
  error?: unknown;
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export function adobeDgrConfigured() {
  return (
    config.ENABLE_ADOBE_DGR &&
    adobeCredentialsReady({
      clientId: config.ADOBE_CLIENT_ID,
      clientSecret: config.ADOBE_CLIENT_SECRET,
    })
  );
}

export async function resolveAdobeMogrtUrl() {
  if (config.ADOBE_MOGRT_URL) return config.ADOBE_MOGRT_URL;
  const key = config.ADOBE_MOGRT_OBJECT_KEY;
  if (!key) return null;
  if (config.MINIO_PUBLIC_ENDPOINT) {
    const publicStorage = new Client({
      endPoint: config.MINIO_PUBLIC_ENDPOINT,
      port: config.MINIO_PUBLIC_PORT,
      useSSL: config.MINIO_PUBLIC_SSL,
      accessKey: config.MINIO_ACCESS_KEY,
      secretKey: config.MINIO_SECRET_KEY,
    });
    return publicStorage.presignedGetObject(config.MINIO_BUCKET, key, 12 * 60 * 60);
  }
  return minio.presignedGetObject(config.MINIO_BUCKET, key, 12 * 60 * 60);
}

export function adobeCredentialsFromConfig(): AdobeCredentials | null {
  if (!config.ADOBE_CLIENT_ID || !config.ADOBE_CLIENT_SECRET) return null;
  return {
    clientId: config.ADOBE_CLIENT_ID,
    clientSecret: config.ADOBE_CLIENT_SECRET,
    scopes: config.ADOBE_IMS_SCOPE,
  };
}

export async function adobeAccessToken() {
  const credentials = adobeCredentialsFromConfig();
  if (!credentials) throw new Error('ADOBE_NOT_CONFIGURED');
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.accessToken;
  const token = await fetchAdobeAccessToken(credentials);
  cachedToken = {
    accessToken: token.accessToken,
    expiresAt: Date.now() + token.expiresInSec * 1000,
  };
  return cachedToken.accessToken;
}

async function adobeJson(path: string, init?: RequestInit) {
  const credentials = adobeCredentialsFromConfig();
  if (!credentials) throw new Error('ADOBE_NOT_CONFIGURED');
  const token = await adobeAccessToken();
  const response = await fetch(`${ADOBE_AV_API_BASE}${path}`, {
    ...init,
    headers: {
      ...adobeAvHeaders(credentials.clientId, token, config.ADOBE_ORG_ID),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`ADOBE_BAD_JSON:${text.slice(0, 120)}`);
    }
  }
  if (!response.ok) {
    throw new Error(`ADOBE_${response.status}:${text.slice(0, 220)}`);
  }
  return json;
}

export async function listAdobePresets() {
  const json = await adobeJson('/v1/presets');
  const presets = Array.isArray(json.presets) ? json.presets : Array.isArray(json) ? json : [];
  return presets as Array<{ presetId?: string; label?: string }>;
}

export async function probeAdobeDgr() {
  if (!adobeDgrConfigured()) {
    return { ok: false as const, reason: 'not_configured' };
  }
  const presets = await listAdobePresets();
  return {
    ok: true as const,
    presetCount: presets.length,
    hasVertical: presets.some((item) => item.presetId === ADOBE_VERTICAL_PRESET),
  };
}

function controlsFromDescribe(payload: Record<string, unknown>): AdobeDgrControl[] {
  const nested =
    (payload.controls as AdobeDgrControl[] | undefined) ??
    (payload.result as { controls?: AdobeDgrControl[] } | undefined)?.controls;
  return Array.isArray(nested) ? nested : [];
}

async function waitAdobeJob(started: Record<string, unknown>, timeoutMs = 180_000) {
  const jobId = String(started.jobId ?? started.job_id ?? '');
  const statusUrl = String(started.statusUrl ?? started.status_url ?? '');
  if (!jobId && !statusUrl) {
    if (
      String(started.status ?? '')
        .toLowerCase()
        .match(/succeed|complete|done/)
    ) {
      return started as AdobeJobStatus;
    }
    throw new Error('ADOBE_JOB_ID_MISSING');
  }
  const deadline = Date.now() + timeoutMs;
  let last: AdobeJobStatus = started as AdobeJobStatus;
  while (Date.now() < deadline) {
    const status = last.status?.toLowerCase();
    if (status === 'succeeded' || status === 'completed' || status === 'done') return last;
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      throw new Error(`ADOBE_JOB_${status}:${jobId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const path = statusUrl.startsWith('http')
      ? `${new URL(statusUrl).pathname}${new URL(statusUrl).search}`
      : statusUrl
        ? statusUrl.replace(ADOBE_AV_API_BASE, '')
        : `/v1/status/${encodeURIComponent(jobId)}`;
    last = (await adobeJson(path.startsWith('/') ? path : `/${path}`)) as AdobeJobStatus;
  }
  throw new Error(`ADOBE_JOB_TIMEOUT:${jobId}`);
}

function outputUrlFromJob(job: AdobeJobStatus) {
  const outputs = job.outputs ?? job.result?.outputs ?? [];
  return outputs.map((item) => item.url ?? item.destination?.url).find(Boolean) ?? null;
}

export async function renderAdobeGraphics(input: {
  mogrtUrl: string;
  copy: { title?: string | null; cta?: string | null; lowerThird?: string | null };
  outputPath: string;
}) {
  const described = await adobeJson('/v1/templates/describe', {
    method: 'POST',
    body: JSON.stringify({ source: { url: input.mogrtUrl } }),
  });
  const ready =
    controlsFromDescribe(described).length > 0
      ? described
      : ((await waitAdobeJob(described)) as Record<string, unknown>);
  const controls = controlsFromDescribe(ready);
  const variables = dgrTextVariables(controls, input.copy);
  const started = await adobeJson('/v1/templates/render', {
    method: 'POST',
    body: JSON.stringify({
      source: { url: input.mogrtUrl },
      presets: [{ source: { presetId: config.ADOBE_PRESET_ID } }],
      variations: [{ variables }],
      outputs: [{ variationIndex: 0, presetIndex: 0, fileName: 'cenapronta-dgr' }],
    }),
  });
  const job = await waitAdobeJob(started);
  const url = outputUrlFromJob(job);
  if (!url) throw new Error('ADOBE_OUTPUT_MISSING');
  const media = await fetch(url);
  if (!media.ok) throw new Error(`ADOBE_DOWNLOAD_${media.status}`);
  await writeFile(input.outputPath, Buffer.from(await media.arrayBuffer()));
  return { outputPath: input.outputPath, variableCount: variables.length };
}
