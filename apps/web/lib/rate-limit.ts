import { Redis } from 'ioredis';
import { getServerEnv } from './env';

let connection: Redis | undefined;

export async function enforceRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options: { failClosed?: boolean } = {},
) {
  try {
    const env = getServerEnv();
    connection ??= new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2500,
      enableOfflineQueue: false,
    });
    if (connection.status !== 'ready') {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          if (connection?.status === 'ready') {
            resolve();
            return;
          }
          const onReady = () => {
            connection?.off('error', onError);
            resolve();
          };
          const onError = (error: Error) => {
            connection?.off('ready', onReady);
            reject(error);
          };
          connection?.once('ready', onReady);
          connection?.once('error', onError);
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('REDIS_TIMEOUT')), 2500);
        }),
      ]);
    }
    const redisKey = `reelops:limit:${key}`;
    const count = Number(
      await connection.eval(
        "local value=redis.call('INCR',KEYS[1]); if value==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return value",
        1,
        redisKey,
        windowSeconds,
      ),
    );
    if (count > limit) throw new Error('RATE_LIMITED');
  } catch (error) {
    if (error instanceof Error && error.message === 'RATE_LIMITED') throw error;
    connection = undefined;
    if (options.failClosed) throw new Error('RATE_LIMITED');
  }
}
