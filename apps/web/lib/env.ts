import { z } from "zod";

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_DB_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z.string().default("false").transform((value) => value === "true"),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_BUCKET: z.string().min(3).default("restaurant-media"),
  APP_URL: z.string().url(),
  INGEST_API_KEY: z.string().min(24),
  MAX_SEGMENT_BYTES: z.coerce.number().int().min(1_048_576).max(2_147_483_648).default(268_435_456),
  MOMENT_WINDOW_BEFORE_SECONDS: z.coerce.number().int().min(3).max(120).default(12),
  MOMENT_WINDOW_AFTER_SECONDS: z.coerce.number().int().min(3).max(120).default(8),
  RAW_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  MINIO_PUBLIC_ENDPOINT: z.string().min(1).optional(),
  MINIO_PUBLIC_PORT: z.coerce.number().int().positive().default(443),
  MINIO_PUBLIC_SSL: z.string().default("true").transform((value) => value === "true"),
  META_ACCESS_TOKEN: z.string().min(1).optional(),
  META_INSTAGRAM_ACCOUNT_ID: z.string().min(1).optional(),
  META_GRAPH_API_VERSION: z.string().default("v23.0")
});

export type ServerEnv = z.infer<typeof serverSchema>;

export type ConfigItem = {
  key: string;
  label: string;
  group: "Supabase" | "Armazenamento" | "Fila" | "Aplicação" | "Publicação";
  required: boolean;
  configured: boolean;
  secret: boolean;
  hint: string;
};

const definitions: Omit<ConfigItem, "configured">[] = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", label: "URL do Supabase", group: "Supabase", required: true, secret: false, hint: "Settings → API → Project URL" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "Chave pública do Supabase", group: "Supabase", required: true, secret: true, hint: "Settings → API → anon public" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", label: "Chave de serviço do Supabase", group: "Supabase", required: true, secret: true, hint: "Settings → API → service_role" },
  { key: "SUPABASE_DB_URL", label: "Conexão direta do banco", group: "Supabase", required: true, secret: true, hint: "Database → Connect → Direct connection; usada nas migrations" },
  { key: "REDIS_URL", label: "Endereço do Redis", group: "Fila", required: true, secret: true, hint: "No Docker use redis://redis:6379" },
  { key: "MINIO_ENDPOINT", label: "Servidor MinIO", group: "Armazenamento", required: true, secret: false, hint: "Hostname sem http:// ou https://" },
  { key: "MINIO_PORT", label: "Porta do MinIO", group: "Armazenamento", required: true, secret: false, hint: "Normalmente 9000" },
  { key: "MINIO_USE_SSL", label: "SSL do MinIO", group: "Armazenamento", required: true, secret: false, hint: "true para HTTPS; false na rede Docker privada" },
  { key: "MINIO_ACCESS_KEY", label: "Usuário do MinIO", group: "Armazenamento", required: true, secret: true, hint: "Use uma conta restrita ao bucket" },
  { key: "MINIO_SECRET_KEY", label: "Senha do MinIO", group: "Armazenamento", required: true, secret: true, hint: "Nunca exponha esta chave no navegador" },
  { key: "MINIO_BUCKET", label: "Bucket de mídia", group: "Armazenamento", required: true, secret: false, hint: "Exemplo: restaurant-media" },
  { key: "APP_URL", label: "URL pública do ReelOps", group: "Aplicação", required: true, secret: false, hint: "Exemplo: https://reels.seudominio.com" },
  { key: "INGEST_API_KEY", label: "Chave de envio do NVR", group: "Aplicação", required: true, secret: true, hint: "Gere uma sequência aleatória com pelo menos 24 caracteres" },
  { key: "META_ACCESS_TOKEN", label: "Token da Meta", group: "Publicação", required: false, secret: true, hint: "Opcional: habilita publicação automática no Instagram" },
  { key: "META_INSTAGRAM_ACCOUNT_ID", label: "ID da conta Instagram", group: "Publicação", required: false, secret: false, hint: "Opcional: conta profissional vinculada à Meta" },
  { key: "MINIO_PUBLIC_ENDPOINT", label: "Domínio público da mídia", group: "Publicação", required: false, secret: false, hint: "Opcional: domínio HTTPS do MinIO acessível pela Meta" }
];

function hasRealValue(key: string) {
  const value = process.env[key]?.trim();
  return Boolean(value && !/(replace[_-]?me|change[_-]?me|your_|validation|example\.supabase\.co|seudominio\.com)/i.test(value));
}

export function getConfigItems(): ConfigItem[] {
  return definitions.map((definition) => ({ ...definition, configured: hasRealValue(definition.key) }));
}

export function isCoreConfigured() {
  return getConfigItems().filter((item) => item.required && item.key !== "SUPABASE_DB_URL").every((item) => item.configured);
}

export function isInstallationConfigured() {
  return getConfigItems().filter((item) => item.required).every((item) => item.configured);
}

export function getServerEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`CONFIGURATION_REQUIRED:${missing}`);
  }
  return parsed.data;
}

export function getPublicRuntimeConfig() {
  const env = getServerEnv();
  return { supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
}

export function hasInstagramPublisher() {
  return hasRealValue("META_ACCESS_TOKEN") && hasRealValue("META_INSTAGRAM_ACCOUNT_ID") && hasRealValue("MINIO_PUBLIC_ENDPOINT");
}
