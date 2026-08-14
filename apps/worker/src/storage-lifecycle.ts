import { STORAGE_ROOT } from '@reelops/shared';
import { runtimeStatus } from './runtime-status.js';

export const RAW_RETENTION_RULE_ID = 'reelops-raw-retention';

type LifecycleRule = {
  ID?: string;
  Status?: string;
  Filter?: { Prefix?: string };
  Expiration?: { Days?: number };
};

type LifecycleConfig = { Rule?: LifecycleRule | LifecycleRule[] };

type StorageLog = {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
};

type StorageClient = {
  bucketExists: (bucket: string) => Promise<boolean>;
  makeBucket: (bucket: string) => Promise<void>;
  getBucketLifecycle: (bucket: string) => Promise<LifecycleConfig | null>;
  setBucketLifecycle: (bucket: string, config: { Rule: LifecycleRule[] }) => Promise<void>;
};

export function normalizeLifecycleRules(
  current: LifecycleConfig | null | undefined,
): LifecycleRule[] {
  const raw = current?.Rule;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export function rawRetentionRule(days: number): LifecycleRule {
  return {
    ID: RAW_RETENTION_RULE_ID,
    Status: 'Enabled',
    Filter: { Prefix: `${STORAGE_ROOT}/raw/` },
    Expiration: { Days: days },
  };
}

export async function bootstrapStorage(input: {
  minio: StorageClient;
  bucket: string;
  retentionDays: number;
  log: StorageLog;
}) {
  if (!(await input.minio.bucketExists(input.bucket))) await input.minio.makeBucket(input.bucket);
  try {
    const current = await input.minio.getBucketLifecycle(input.bucket).catch(() => null);
    const desired = rawRetentionRule(input.retentionDays);
    const others = normalizeLifecycleRules(current).filter(
      (rule) => rule.ID !== RAW_RETENTION_RULE_ID,
    );
    const existing = normalizeLifecycleRules(current).find(
      (rule) => rule.ID === RAW_RETENTION_RULE_ID,
    );
    const alreadySet =
      existing?.Status === 'Enabled' &&
      existing.Filter?.Prefix === desired.Filter?.Prefix &&
      Number(existing.Expiration?.Days) === Number(desired.Expiration?.Days);
    if (!alreadySet) {
      await input.minio.setBucketLifecycle(input.bucket, { Rule: [...others, desired] });
    }
    runtimeStatus.rawLifecycle = 'ok';
    input.log.info(
      { retentionDays: input.retentionDays, alreadySet: Boolean(alreadySet) },
      'raw retention ready',
    );
  } catch (err) {
    runtimeStatus.rawLifecycle = 'unconfigured';
    input.log.warn(
      { err },
      'lifecycle configuration skipped; configure cenapronta/raw/ retention in MinIO',
    );
  }
}
