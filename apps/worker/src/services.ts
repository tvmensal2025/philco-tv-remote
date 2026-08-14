import { createClient } from '@supabase/supabase-js';
import { Client } from 'minio';
import { Redis as IORedis } from 'ioredis';
import pino from 'pino';
import WebSocket from 'ws';
import { config } from './config.js';
import { supabaseFetch } from './supabase-fetch.js';

export const db = createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { fetch: supabaseFetch },
  realtime: { transport: WebSocket as never },
});
export const minio = new Client({
  endPoint: config.MINIO_ENDPOINT,
  port: config.MINIO_PORT,
  useSSL: config.MINIO_USE_SSL,
  accessKey: config.MINIO_ACCESS_KEY,
  secretKey: config.MINIO_SECRET_KEY,
});
export const redis = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  connectTimeout: 10_000,
});
export const log = pino({ level: config.LOG_LEVEL });
