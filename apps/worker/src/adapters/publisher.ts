import { Client } from "minio";
import { config } from "../config.js";

export type PublishInput = { reelId: string; provider: string; objectPath: string; caption: string };
export interface Publisher { publish(input: PublishInput): Promise<{ externalId: string }> }

class InstagramPublisher implements Publisher {
  async publish(input: PublishInput) {
    if (!config.META_ACCESS_TOKEN || !config.META_INSTAGRAM_ACCOUNT_ID || !config.MINIO_PUBLIC_ENDPOINT) throw new Error("INSTAGRAM_NOT_CONFIGURED");
    const publicStorage = new Client({
      endPoint: config.MINIO_PUBLIC_ENDPOINT,
      port: config.MINIO_PUBLIC_PORT,
      useSSL: config.MINIO_PUBLIC_SSL,
      accessKey: config.MINIO_ACCESS_KEY,
      secretKey: config.MINIO_SECRET_KEY
    });
    const videoUrl = await publicStorage.presignedGetObject(config.MINIO_BUCKET, input.objectPath, 60 * 60);
    const base = `https://graph.facebook.com/${config.META_GRAPH_API_VERSION}`;
    const create = await graphRequest(`${base}/${config.META_INSTAGRAM_ACCOUNT_ID}/media`, {
      media_type: "REELS",
      video_url: videoUrl,
      caption: input.caption,
      share_to_feed: "true",
      access_token: config.META_ACCESS_TOKEN
    });
    const creationId = String(create.id ?? "");
    if (!creationId) throw new Error("META_CONTAINER_NOT_CREATED");

    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      const status = await graphGet(`${base}/${creationId}`, { fields: "status_code,status", access_token: config.META_ACCESS_TOKEN });
      if (status.status_code === "FINISHED") break;
      if (["ERROR", "EXPIRED"].includes(String(status.status_code))) throw new Error(`META_PROCESSING_${status.status_code}:${status.status ?? ""}`);
      if (attempt === 29) throw new Error("META_PROCESSING_TIMEOUT");
    }
    const published = await graphRequest(`${base}/${config.META_INSTAGRAM_ACCOUNT_ID}/media_publish`, { creation_id: creationId, access_token: config.META_ACCESS_TOKEN });
    if (!published.id) throw new Error("META_PUBLISH_FAILED");
    return { externalId: String(published.id) };
  }
}

async function graphRequest(url: string, values: Record<string, string>) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`META_API_ERROR:${JSON.stringify(data).slice(0, 500)}`);
  return data;
}

async function graphGet(url: string, values: Record<string, string>) {
  const response = await fetch(`${url}?${new URLSearchParams(values)}`);
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`META_API_ERROR:${JSON.stringify(data).slice(0, 500)}`);
  return data;
}

export function createPublisher(provider: string): Publisher {
  if (provider === "instagram") return new InstagramPublisher();
  throw new Error(`PUBLISHER_NOT_SUPPORTED:${provider}`);
}
