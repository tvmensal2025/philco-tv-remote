import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

function rewriteLocalHosts() {
  if (existsSync('/.dockerenv')) return;
  const redis = process.env.REDIS_URL;
  if (redis) {
    process.env.REDIS_URL = redis.replace(/:\/\/(?:redis|cenaforte)(?=[:/?]|$)/, '://127.0.0.1');
  }
  const minio = process.env.MINIO_ENDPOINT;
  if (minio === 'minio') process.env.MINIO_ENDPOINT = '127.0.0.1';
  if (process.env.APP_URL && /seudominio\.com/i.test(process.env.APP_URL)) {
    process.env.APP_URL = 'http://localhost:3000';
  }
}

export function loadRootEnv(fromDir = process.cwd()) {
  let dir = fromDir;
  for (let i = 0; i < 8; i++) {
    const file = join(dir, '.env');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && process.env[match[1]] === undefined) {
          process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
        }
      }
      rewriteLocalHosts();
      const puppeteer = process.env.PUPPETEER_CACHE_DIR;
      if (puppeteer && !isAbsolute(puppeteer)) {
        process.env.PUPPETEER_CACHE_DIR = resolve(dir, puppeteer);
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  rewriteLocalHosts();
}
