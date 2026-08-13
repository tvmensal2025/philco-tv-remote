import { z } from "zod";
export const config=z.object({
 REDIS_URL:z.string(),NEXT_PUBLIC_SUPABASE_URL:z.string().url(),SUPABASE_SERVICE_ROLE_KEY:z.string(),
 MINIO_ENDPOINT:z.string(),MINIO_PORT:z.coerce.number().default(9000),MINIO_USE_SSL:z.string().transform(v=>v==="true").default("false"),
 MINIO_ACCESS_KEY:z.string(),MINIO_SECRET_KEY:z.string(),MINIO_BUCKET:z.string().default("restaurant-media"),
 WORKER_CONCURRENCY:z.coerce.number().int().min(1).default(2),FFMPEG_PRESET:z.string().default("veryfast"),LOG_LEVEL:z.string().default("info"),
 NVR_SEGMENT_SECONDS:z.coerce.number().int().min(5).max(600).default(60),RAW_RETENTION_DAYS:z.coerce.number().int().min(1).max(365).default(7),
 WORK_DIR:z.string().default("/tmp/reelops"),META_ACCESS_TOKEN:z.string().optional(),META_INSTAGRAM_ACCOUNT_ID:z.string().optional(),META_GRAPH_API_VERSION:z.string().default("v23.0"),
 MINIO_PUBLIC_ENDPOINT:z.string().optional(),MINIO_PUBLIC_PORT:z.coerce.number().int().positive().default(443),MINIO_PUBLIC_SSL:z.string().default("true").transform(v=>v==="true")
}).parse(process.env);
