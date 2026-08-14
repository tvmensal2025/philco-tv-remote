import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function parseEnvFile(file: string) {
  let text = readFileSync(file);
  if (text[0] === 0xef && text[1] === 0xbb && text[2] === 0xbf) text = text.subarray(3);
  const parsed: Record<string, string> = {};
  for (const line of text.toString('utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    parsed[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return parsed;
}

function applyLocalHostAliases(env: NodeJS.ProcessEnv) {
  if (existsSync('/.dockerenv')) return;
  const redis = env.REDIS_URL;
  if (redis) {
    env.REDIS_URL = redis.replace(/:\/\/(?:redis|cenaforte)(?=[:/?]|$)/, '://127.0.0.1');
  }
  if (env.MINIO_ENDPOINT === 'minio') env.MINIO_ENDPOINT = '127.0.0.1';
  if (env.APP_URL && /seudominio\.com/i.test(env.APP_URL)) {
    env.APP_URL = 'http://localhost:3000';
  }
}

function applyMinioAliases(env: NodeJS.ProcessEnv) {
  const serverUrl = env.MINIO_SERVER_URL?.trim() ?? '';
  if (!env.MINIO_ENDPOINT && serverUrl) {
    env.MINIO_ENDPOINT = serverUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }
  if (!env.MINIO_ACCESS_KEY && env.MINIO_ROOT_USER) env.MINIO_ACCESS_KEY = env.MINIO_ROOT_USER;
  if (!env.MINIO_SECRET_KEY && env.MINIO_ROOT_PASSWORD)
    env.MINIO_SECRET_KEY = env.MINIO_ROOT_PASSWORD;
  if (!env.MINIO_PORT && /^https:/i.test(serverUrl)) env.MINIO_PORT = '443';
  if (!env.MINIO_USE_SSL && serverUrl)
    env.MINIO_USE_SSL = /^https:/i.test(serverUrl) ? 'true' : 'false';
  if (!env.WAME_API_KEY && env.WAME_API_KEY_RITA) env.WAME_API_KEY = env.WAME_API_KEY_RITA;
}

export function loadRootEnv(fromDir = process.cwd()) {
  let dir = fromDir;
  for (let i = 0; i < 8; i++) {
    const file = join(dir, '.env');
    if (existsSync(file)) {
      const parsed = parseEnvFile(file);
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  applyMinioAliases(process.env);
  applyLocalHostAliases(process.env);
}
