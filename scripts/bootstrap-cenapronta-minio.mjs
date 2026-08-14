import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Client } from 'minio';

function readEnv(file) {
  const map = new Map();
  if (!existsSync(file)) return map;
  let text = readFileSync(file);
  if (text[0] === 0xef && text[1] === 0xbb && text[2] === 0xbf) text = text.subarray(3);
  for (const line of text.toString('utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) map.set(match[1], match[2].replace(/^['"]|['"]$/g, ''));
  }
  return map;
}

function upsert(source, key, value) {
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=`, 'm').test(source))
    return source.replace(new RegExp(`^${key}=.*$`, 'm'), line);
  return source + (source.endsWith('\n') ? '' : '\n') + line + '\n';
}

const host = 'cenapronta-minio.d9v63q.easypanel.host';
const user = process.env.MINIO_ROOT_USER;
const password = process.env.MINIO_ROOT_PASSWORD;
if (!user || !password) {
  console.error('MINIO_ROOT_USER e MINIO_ROOT_PASSWORD são obrigatórios');
  process.exit(1);
}
const bucket = 'cenapronta';

let source = existsSync('.env') ? readFileSync('.env', 'utf8').replaceAll('\r\n', '\n') : '';
source = upsert(source, 'MINIO_SERVER_URL', `https://${host}`);
source = upsert(source, 'MINIO_ROOT_USER', user);
source = upsert(source, 'MINIO_ROOT_PASSWORD', password);
source = upsert(source, 'MINIO_ENDPOINT', host);
source = upsert(source, 'MINIO_PORT', '443');
source = upsert(source, 'MINIO_USE_SSL', 'true');
source = upsert(source, 'MINIO_ACCESS_KEY', user);
source = upsert(source, 'MINIO_SECRET_KEY', password);
source = upsert(source, 'MINIO_BUCKET', bucket);
source = upsert(source, 'MINIO_PUBLIC_ENDPOINT', host);
source = upsert(source, 'MINIO_PUBLIC_PORT', '443');
source = upsert(source, 'MINIO_PUBLIC_SSL', 'true');

const currentRedis = readEnv('.env').get('REDIS_URL') ?? '';
if (!currentRedis || /igreen|CHANGE_ME|redis:\/\/redis(?::|\/|$)/i.test(currentRedis)) {
  source = upsert(source, 'REDIS_URL', 'redis://cenaforte:6379');
}

writeFileSync('.env', source.endsWith('\n') ? source : source + '\n');

const minio = new Client({
  endPoint: host,
  port: 443,
  useSSL: true,
  accessKey: user,
  secretKey: password,
});

const exists = await minio.bucketExists(bucket);
if (!exists) await minio.makeBucket(bucket);
const buckets = await minio.listBuckets();
console.log(
  `minio-ok host=${host} bucket=${bucket} created=${!exists} buckets=${buckets.map((item) => item.name).join(',')}`,
);
