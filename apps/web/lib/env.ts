import { z } from 'zod';
import { loadRootEnv } from './load-root-env';
import { assertAuthPolicy } from './auth-policy';

loadRootEnv();

const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length ? value.trim() : undefined),
  z.string().min(1).optional(),
);

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_DB_URL: optionalText,
  REDIS_URL: z.string().min(1),
  MINIO_ENDPOINT: z.preprocess(
    () =>
      (process.env.MINIO_ENDPOINT || process.env.MINIO_SERVER_URL || '')
        .replace(/^https?:\/\//i, '')
        .replace(/\/$/, ''),
    z.string().min(1),
  ),
  MINIO_PORT: z.preprocess(
    (value) => value || (/^https:/i.test(process.env.MINIO_SERVER_URL ?? '') ? '443' : undefined),
    z.coerce.number().int().positive().default(9000),
  ),
  MINIO_USE_SSL: z.preprocess(
    (value) =>
      typeof value === 'string' && value.length
        ? value
        : /^https:/i.test(process.env.MINIO_SERVER_URL ?? '')
          ? 'true'
          : 'false',
    z.string().transform((value) => value === 'true'),
  ),
  MINIO_ACCESS_KEY: z.preprocess(
    () => process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER,
    z.string().min(1),
  ),
  MINIO_SECRET_KEY: z.preprocess(
    () => process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD,
    z.string().min(8),
  ),
  MINIO_BUCKET: z.string().min(3).default('cenapronta'),
  APP_URL: z.string().url(),
  INGEST_API_KEY: z.string().min(24),
  NVR_SEGMENT_SECONDS: z.coerce.number().int().min(5).max(600).default(60),
  MAX_SEGMENT_BYTES: z.coerce.number().int().min(1_048_576).max(2_147_483_648).default(268_435_456),
  MOMENT_WINDOW_BEFORE_SECONDS: z.coerce.number().int().min(3).max(120).default(12),
  MOMENT_WINDOW_AFTER_SECONDS: z.coerce.number().int().min(3).max(120).default(8),
  RAW_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  MINIO_PUBLIC_ENDPOINT: optionalText,
  MINIO_PUBLIC_PORT: z.coerce.number().int().positive().default(443),
  MINIO_PUBLIC_SSL: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),
  META_ACCESS_TOKEN: optionalText,
  META_INSTAGRAM_ACCOUNT_ID: optionalText,
  META_GRAPH_API_VERSION: z.string().default('v23.0'),
  GEMINI_API_KEY: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length >= 10 ? value.trim() : undefined),
    z.string().min(10).optional(),
  ),
  CRON_SECRET: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length >= 16 ? value.trim() : undefined),
    z.string().min(16).optional(),
  ),
  WAME_API_KEY: z.preprocess((value) => {
    const direct = typeof value === 'string' ? value.trim() : '';
    const shared = process.env.WAME_API_KEY_RITA?.trim() ?? '';
    const key = direct.length >= 8 ? direct : shared;
    return key.length >= 8 ? key : undefined;
  }, z.string().min(8).optional()),
  WAME_SERVER: z.preprocess(
    (value) =>
      typeof value === 'string' && /^https?:\/\//i.test(value.trim())
        ? value.trim().replace(/\/$/, '')
        : undefined,
    z.string().url().optional(),
  ),
  PLATFORM_ADMIN_EMAILS: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().includes('@') ? value.trim() : undefined),
    z.string().optional(),
  ),
});

export type ServerEnv = z.infer<typeof serverSchema>;

export type ConfigItem = {
  key: string;
  label: string;
  group:
    'Supabase' | 'Armazenamento' | 'Fila' | 'Aplicação' | 'Publicação' | 'IA' | 'Casa' | 'Estúdio';
  required: boolean;
  configured: boolean;
  secret: boolean;
  hint: string;
};

const definitions: Omit<ConfigItem, 'configured'>[] = [
  {
    key: 'NEXT_PUBLIC_SUPABASE_URL',
    label: 'Conta',
    group: 'Casa',
    required: true,
    secret: false,
    hint: 'Endereço da conta CenaPronta',
  },
  {
    key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    label: 'Acesso público',
    group: 'Casa',
    required: true,
    secret: true,
    hint: 'Login da equipe',
  },
  {
    key: 'SUPABASE_SERVICE_ROLE_KEY',
    label: 'Acesso interno',
    group: 'Casa',
    required: true,
    secret: true,
    hint: 'Servidor da casa',
  },
  {
    key: 'SUPABASE_DB_URL',
    label: 'Dados',
    group: 'Casa',
    required: true,
    secret: true,
    hint: 'Onde os Reels e momentos ficam',
  },
  {
    key: 'REDIS_URL',
    label: 'Fila de corte',
    group: 'Estúdio',
    required: true,
    secret: true,
    hint: 'Ordem de edição e publicação',
  },
  {
    key: 'MINIO_ENDPOINT',
    label: 'Armazenamento',
    group: 'Estúdio',
    required: true,
    secret: false,
    hint: 'Onde os vídeos ficam guardados',
  },
  {
    key: 'MINIO_PORT',
    label: 'Porta do armazenamento',
    group: 'Estúdio',
    required: false,
    secret: false,
    hint: 'Ajuste fino do servidor de mídia',
  },
  {
    key: 'MINIO_USE_SSL',
    label: 'Conexão segura',
    group: 'Estúdio',
    required: false,
    secret: false,
    hint: 'HTTPS do armazenamento',
  },
  {
    key: 'MINIO_ACCESS_KEY',
    label: 'Usuário da mídia',
    group: 'Estúdio',
    required: true,
    secret: true,
    hint: 'Acesso ao cofre de vídeos',
  },
  {
    key: 'MINIO_SECRET_KEY',
    label: 'Senha da mídia',
    group: 'Estúdio',
    required: true,
    secret: true,
    hint: 'Nunca aparece no navegador',
  },
  {
    key: 'MINIO_BUCKET',
    label: 'Cofre de vídeos',
    group: 'Estúdio',
    required: true,
    secret: false,
    hint: 'Pasta exclusiva desta casa',
  },
  {
    key: 'APP_URL',
    label: 'Endereço do CenaPronta',
    group: 'Casa',
    required: true,
    secret: false,
    hint: 'Link que a equipe abre',
  },
  {
    key: 'INGEST_API_KEY',
    label: 'Chave das câmeras',
    group: 'Casa',
    required: true,
    secret: true,
    hint: 'O que autoriza o envio dos ISOs',
  },
  {
    key: 'META_ACCESS_TOKEN',
    label: 'Instagram',
    group: 'Publicação',
    required: false,
    secret: true,
    hint: 'Publicar depois da aprovação',
  },
  {
    key: 'META_INSTAGRAM_ACCOUNT_ID',
    label: 'Conta Instagram',
    group: 'Publicação',
    required: false,
    secret: false,
    hint: 'Perfil profissional da casa',
  },
  {
    key: 'MINIO_PUBLIC_ENDPOINT',
    label: 'Link público dos Reels',
    group: 'Publicação',
    required: false,
    secret: false,
    hint: 'Para WhatsApp e Instagram baixarem o MP4',
  },
  {
    key: 'GEMINI_API_KEY',
    label: 'Visão da IA',
    group: 'Estúdio',
    required: false,
    secret: true,
    hint: 'Só recebe os segundos bons, nunca o turno inteiro',
  },
  {
    key: 'WAME_API_KEY',
    label: 'WhatsApp',
    group: 'Publicação',
    required: false,
    secret: true,
    hint: 'Resumo do turno no celular da casa',
  },
  {
    key: 'CRON_SECRET',
    label: 'Envio diário',
    group: 'Casa',
    required: false,
    secret: true,
    hint: 'Dispara o resumo no horário certo',
  },
];

const envAliases: Record<string, string[]> = {
  MINIO_ENDPOINT: ['MINIO_ENDPOINT', 'MINIO_SERVER_URL'],
  MINIO_ACCESS_KEY: ['MINIO_ACCESS_KEY', 'MINIO_ROOT_USER'],
  MINIO_SECRET_KEY: ['MINIO_SECRET_KEY', 'MINIO_ROOT_PASSWORD'],
  WAME_API_KEY: ['WAME_API_KEY', 'WAME_API_KEY_RITA'],
};

function hasRealValue(key: string) {
  const candidates = envAliases[key] ?? [key];
  const value = candidates.map((candidate) => process.env[candidate]?.trim()).find(Boolean) ?? '';
  if (
    key === 'MINIO_PORT' &&
    !value &&
    (process.env.MINIO_ENDPOINT || process.env.MINIO_SERVER_URL)
  )
    return true;
  if (
    key === 'MINIO_USE_SSL' &&
    !value &&
    (process.env.MINIO_ENDPOINT || process.env.MINIO_SERVER_URL)
  )
    return true;
  return Boolean(
    value &&
    !/(replace[_-]?me|change[_-]?me|your_|validation|example\.supabase\.co|seudominio\.com)/i.test(
      value,
    ),
  );
}

export function getConfigItems(): ConfigItem[] {
  return definitions.map((definition) => ({
    ...definition,
    configured: hasRealValue(definition.key),
  }));
}

export function isCoreConfigured() {
  return getConfigItems()
    .filter((item) => item.required && item.key !== 'SUPABASE_DB_URL')
    .every((item) => item.configured);
}

export { isAuthBypass, isProductionEnv, assertAuthPolicy } from './auth-policy';

export function isInstallationConfigured() {
  return getConfigItems()
    .filter((item) => item.required)
    .every((item) => item.configured);
}

export function getServerEnv(): ServerEnv {
  assertAuthPolicy();
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`CONFIGURATION_REQUIRED:${missing}`);
  }
  return parsed.data;
}

export function getPublicRuntimeConfig() {
  const env = getServerEnv();
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function hasInstagramPublisher() {
  return (
    hasRealValue('META_ACCESS_TOKEN') &&
    hasRealValue('META_INSTAGRAM_ACCOUNT_ID') &&
    hasRealValue('MINIO_PUBLIC_ENDPOINT')
  );
}
