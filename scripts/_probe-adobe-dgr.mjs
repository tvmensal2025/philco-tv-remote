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
if (!clientId || !clientSecret) {
  console.log(JSON.stringify({ ok: false, reason: 'missing_credentials' }));
  process.exit(1);
}

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
const presetsRes = await fetch('https://audio-video-api.adobe.io/v1/presets', {
  headers: {
    authorization: `Bearer ${token.access_token}`,
    'x-api-key': clientId,
    ...(env.ADOBE_ORG_ID ? { 'x-gw-ims-org-id': env.ADOBE_ORG_ID } : {}),
  },
});
const presetsText = await presetsRes.text();
let presetCount = 0;
try {
  const json = JSON.parse(presetsText);
  const list = Array.isArray(json.presets) ? json.presets : Array.isArray(json) ? json : [];
  presetCount = list.length;
} catch {
  presetCount = -1;
}
if (!presetsRes.ok) {
  console.log(
    JSON.stringify({
      ok: false,
      ims: true,
      tokenExpiresInSec: token.expires_in ?? null,
      presetsStatus: presetsRes.status,
      presetCount,
      detail: presetsText.slice(0, 400),
      webhook: `${String(env.APP_URL || '').replace(/\/$/, '')}/api/adobe/events`,
      mogrt: Boolean(env.ADOBE_MOGRT_URL),
    }),
  );
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    ims: true,
    tokenExpiresInSec: token.expires_in ?? null,
    presetsStatus: presetsRes.status,
    presetCount,
    webhook: `${String(env.APP_URL || '').replace(/\/$/, '')}/api/adobe/events`,
    mogrt: Boolean(env.ADOBE_MOGRT_URL),
  }),
);
