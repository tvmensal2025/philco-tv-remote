import { Client } from "minio";
import { getServerEnv } from "./env";

let client: Client | undefined;

export function storageClient() {
  const env = getServerEnv();
  client ??= new Client({
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY
  });
  return client;
}

export async function ensureStorage() {
  const env = getServerEnv();
  const storage = storageClient();
  if (!(await storage.bucketExists(env.MINIO_BUCKET))) {
    await storage.makeBucket(env.MINIO_BUCKET);
  }
  return { storage, bucket: env.MINIO_BUCKET };
}

export async function signedMediaUrl(path: string, downloadName?: string) {
  const { storage, bucket } = await ensureStorage();
  const params = downloadName ? { "response-content-disposition": `attachment; filename="${downloadName.replaceAll('"', "")}"` } : undefined;
  return storage.presignedGetObject(bucket, path, 15 * 60, params);
}
