import { existsSync, readFileSync } from 'node:fs';

const file = '.env';
if (!existsSync(file)) {
  console.log('NO_ENV_FILE');
  process.exit(0);
}
let text = readFileSync(file);
if (text[0] === 0xef && text[1] === 0xbb && text[2] === 0xbf) text = text.subarray(3);
const keys = [];
const empty = [];
const placeholders = [];
for (const line of text.toString('utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match) continue;
  const [, key, raw] = match;
  const value = raw.replace(/^['"]|['"]$/g, '').trim();
  keys.push(key);
  if (!value) empty.push(key);
  else if (
    /(replace[_-]?me|change[_-]?me|your_|validation|example\.supabase\.co|seudominio\.com)/i.test(
      value,
    )
  )
    placeholders.push(key);
}
const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'REDIS_URL',
  'MINIO_ENDPOINT',
  'MINIO_PORT',
  'MINIO_USE_SSL',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_BUCKET',
  'APP_URL',
  'INGEST_API_KEY',
];
const missing = required.filter(
  (key) => !keys.includes(key) || empty.includes(key) || placeholders.includes(key),
);
console.log(`keys=${keys.length}`);
console.log(`required-missing=${missing.join(',') || 'none'}`);
console.log(`empty=${empty.join(',') || 'none'}`);
console.log(`placeholders=${placeholders.join(',') || 'none'}`);
const redis = keys.includes('REDIS_URL') ? 'present' : 'absent';
console.log(`REDIS_URL=${redis}`);
