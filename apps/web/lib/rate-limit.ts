import { Redis } from "ioredis";
import { getServerEnv } from "./env";

let connection: Redis | undefined;

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const env = getServerEnv();
  connection ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2500 });
  const redisKey = `reelops:limit:${key}`;
  const count = Number(await connection.eval(
    "local value=redis.call('INCR',KEYS[1]); if value==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return value",
    1,
    redisKey,
    windowSeconds
  ));
  if (count > limit) throw new Error("RATE_LIMITED");
}
