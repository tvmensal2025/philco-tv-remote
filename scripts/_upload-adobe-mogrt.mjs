import { readFileSync, existsSync } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const objectKey = env.ADOBE_MOGRT_OBJECT_KEY || 'branding/adobe/neon-arrow-5.mogrt';
const zipPath = 'D:\\DEV\\EDICAO\\Pack Motions\\neon-arrow-pack-2021-09-04-07-36-38-utc.zip';
const localDir = path.resolve('work/adobe');
const localMogrt = path.join(localDir, 'neon-arrow-5.mogrt');
const cached = path.join(process.env.TEMP || '/tmp', 'arrow5.mogrt');

await mkdir(localDir, { recursive: true });
if (existsSync(cached)) {
  await copyFile(cached, localMogrt);
} else {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replaceAll("'", "''")}'); $e = $z.Entries | Where-Object { $_.FullName -eq 'mogrt/arrow 5.mogrt' } | Select-Object -First 1; $out = [System.IO.File]::Create('${localMogrt.replaceAll("'", "''")}'); $e.Open().CopyTo($out); $out.Close(); $z.Dispose()`,
    ],
    { stdio: 'inherit' },
  );
}

const info = await stat(localMogrt);
const { Client } = await import('minio');
const endPoint = (env.MINIO_ENDPOINT || env.MINIO_SERVER_URL || '')
  .replace(/^https?:\/\//i, '')
  .replace(/\/$/, '');
const minio = new Client({
  endPoint,
  port: Number(env.MINIO_PORT || 443),
  useSSL: String(env.MINIO_USE_SSL || 'true') === 'true',
  accessKey: env.MINIO_ACCESS_KEY || env.MINIO_ROOT_USER,
  secretKey: env.MINIO_SECRET_KEY || env.MINIO_ROOT_PASSWORD,
});
await minio.fPutObject(env.MINIO_BUCKET || 'cenapronta', objectKey, localMogrt, {
  'Content-Type': 'application/octet-stream',
});
const publicClient = new Client({
  endPoint: env.MINIO_PUBLIC_ENDPOINT || endPoint,
  port: Number(env.MINIO_PUBLIC_PORT || 443),
  useSSL: String(env.MINIO_PUBLIC_SSL || 'true') === 'true',
  accessKey: env.MINIO_ACCESS_KEY || env.MINIO_ROOT_USER,
  secretKey: env.MINIO_SECRET_KEY || env.MINIO_ROOT_PASSWORD,
});
const url = await publicClient.presignedGetObject(
  env.MINIO_BUCKET || 'cenapronta',
  objectKey,
  12 * 60 * 60,
);

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
const describe = await fetch('https://audio-video-api.adobe.io/v1/templates/describe', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token.access_token}`,
    'x-api-key': env.ADOBE_CLIENT_ID,
    'content-type': 'application/json',
    ...(env.ADOBE_ORG_ID ? { 'x-gw-ims-org-id': env.ADOBE_ORG_ID } : {}),
  },
  body: JSON.stringify({ source: { url } }),
});
const describeText = await describe.text();
console.log(
  JSON.stringify({
    uploaded: objectKey,
    bytes: info.size,
    urlHost: new URL(url).host,
    describeStatus: describe.status,
    describe: describeText.slice(0, 280),
  }),
);
if (!describe.ok) process.exit(1);
