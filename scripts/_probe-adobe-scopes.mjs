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
const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.ADOBE_CLIENT_ID,
    client_secret: env.ADOBE_CLIENT_SECRET,
    scope: env.ADOBE_IMS_SCOPE || 'openid,AdobeID,firefly_api,ff_apis',
  }),
});
const token = JSON.parse(await tokenRes.text());
const payload = JSON.parse(
  Buffer.from(token.access_token.split('.')[1], 'base64url').toString('utf8'),
);
const headers = {
  authorization: `Bearer ${token.access_token}`,
  'x-api-key': env.ADOBE_CLIENT_ID,
  ...(env.ADOBE_ORG_ID ? { 'x-gw-ims-org-id': env.ADOBE_ORG_ID } : {}),
};

async function hit(name, url, init = {}) {
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const body = await response.text();
  return { name, status: response.status, body: body.slice(0, 180) };
}

console.log(
  JSON.stringify(
    {
      tokenOk: tokenRes.ok,
      scope: payload.scope ?? payload.scp ?? null,
      payloadKeys: Object.keys(payload),
      checks: [
        await hit('presets', 'https://audio-video-api.adobe.io/v1/presets'),
        await hit('psd-hello', 'https://image.adobe.io/pie/psdService/hello'),
        await hit('ff-generate', 'https://firefly-api.adobe.io/v2/images/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      ],
    },
    null,
    2,
  ),
);
