import { readFileSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const clientId = env.ADOBE_CLIENT_ID;
const clientSecret = env.ADOBE_CLIENT_SECRET;
const objectKey = env.ADOBE_MOGRT_OBJECT_KEY || 'branding/adobe/neon-arrow-5.mogrt';

const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: env.ADOBE_IMS_SCOPE || 'openid,AdobeID,firefly_api,ff_apis',
  }),
});
const tokenText = await tokenRes.text();
if (!tokenRes.ok) {
  console.log(
    JSON.stringify({
      ok: false,
      step: 'ims',
      status: tokenRes.status,
      detail: tokenText.slice(0, 240),
    }),
  );
  process.exit(1);
}
const token = JSON.parse(tokenText);
const headers = {
  authorization: `Bearer ${token.access_token}`,
  'x-api-key': clientId,
  'content-type': 'application/json',
  ...(env.ADOBE_ORG_ID ? { 'x-gw-ims-org-id': env.ADOBE_ORG_ID } : {}),
};

const presetsRes = await fetch('https://audio-video-api.adobe.io/v1/presets', { headers });
const presetsText = await presetsRes.text();
let presetCount = 0;
let presetIds = [];
try {
  const json = JSON.parse(presetsText);
  const list = Array.isArray(json.presets) ? json.presets : Array.isArray(json) ? json : [];
  presetCount = list.length;
  presetIds = list
    .map((item) => item.presetId)
    .filter(Boolean)
    .slice(0, 8);
} catch {
  presetCount = -1;
}

const { Client } = await import('minio');
const endPoint = (env.MINIO_PUBLIC_ENDPOINT || env.MINIO_ENDPOINT || '')
  .replace(/^https?:\/\//i, '')
  .replace(/\/$/, '');
const minio = new Client({
  endPoint,
  port: Number(env.MINIO_PUBLIC_PORT || env.MINIO_PORT || 443),
  useSSL: true,
  accessKey: env.MINIO_ACCESS_KEY || env.MINIO_ROOT_USER,
  secretKey: env.MINIO_SECRET_KEY || env.MINIO_ROOT_PASSWORD,
});
const mogrtUrl = await minio.presignedGetObject(
  env.MINIO_BUCKET || 'cenapronta',
  objectKey,
  12 * 60 * 60,
);

const describeRes = await fetch('https://audio-video-api.adobe.io/v1/templates/describe', {
  method: 'POST',
  headers,
  body: JSON.stringify({ source: { url: mogrtUrl } }),
});
const describeText = await describeRes.text();
let describeJson = {};
try {
  describeJson = JSON.parse(describeText);
} catch {
  describeJson = { raw: describeText.slice(0, 200) };
}

const result = {
  ok: presetsRes.ok && describeRes.ok,
  ims: true,
  tokenExpiresInSec: token.expires_in ?? null,
  presetsStatus: presetsRes.status,
  presetCount,
  presetIds,
  describeStatus: describeRes.status,
  describeJobId: describeJson.jobId ?? describeJson.job_id ?? null,
  describeStatusUrl: describeJson.statusUrl ?? describeJson.status_url ?? null,
  describeKeys: Object.keys(describeJson).slice(0, 12),
  describeDetail: describeRes.ok ? undefined : describeText.slice(0, 280),
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);

if (describeJson.jobId || describeJson.job_id || describeJson.statusUrl) {
  const statusPath = describeJson.statusUrl
    ? new URL(describeJson.statusUrl).pathname
    : `/v1/status/${encodeURIComponent(describeJson.jobId ?? describeJson.job_id)}`;
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 2500));
    const statusRes = await fetch(`https://audio-video-api.adobe.io${statusPath}`, { headers });
    const statusText = await statusRes.text();
    let statusJson = {};
    try {
      statusJson = JSON.parse(statusText);
    } catch {
      statusJson = {};
    }
    const status = String(statusJson.status ?? '');
    console.log(
      JSON.stringify({
        poll: i + 1,
        http: statusRes.status,
        status,
        keys: Object.keys(statusJson).slice(0, 10),
      }),
    );
    if (/succeed|complete|done|fail|cancel/i.test(status) || statusRes.status === 403) break;
  }
}
