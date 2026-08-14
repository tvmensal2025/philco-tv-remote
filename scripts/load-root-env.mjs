import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function parseEnvFile(file) {
  const parsed = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    parsed[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return parsed;
}

export function findRootEnvFile(fromDir = process.cwd()) {
  let dir = fromDir;
  for (let i = 0; i < 8; i++) {
    const file = join(dir, '.env');
    if (existsSync(file)) return file;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function readRootEnv(fromDir = process.cwd()) {
  const file = findRootEnvFile(fromDir);
  return file ? parseEnvFile(file) : {};
}

export function applyLocalHostAliases(env = process.env) {
  if (existsSync('/.dockerenv')) return env;
  const redis = env.REDIS_URL;
  if (redis) {
    env.REDIS_URL = redis.replace(/:\/\/(?:redis|cenaforte)(?=[:/?]|$)/, '://127.0.0.1');
  }
  if (env.MINIO_ENDPOINT === 'minio') env.MINIO_ENDPOINT = '127.0.0.1';
  if (env.APP_URL && /seudominio\.com/i.test(env.APP_URL)) {
    env.APP_URL = 'http://localhost:3000';
  }
  return env;
}

export function loadRootEnv(fromDir = process.cwd(), { override = false } = {}) {
  const parsed = readRootEnv(fromDir);
  for (const [key, value] of Object.entries(parsed)) {
    if (override || process.env[key] === undefined) process.env[key] = value;
  }
  applyLocalHostAliases(process.env);
  return parsed;
}
