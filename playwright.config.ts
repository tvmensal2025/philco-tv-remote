import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

/**
 * The web server deliberately overrides every installation credential with a
 * placeholder. This keeps E2E runs deterministic and prevents tests from ever
 * reaching a developer's real Supabase, Redis or MinIO services.
 */
const isolatedEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ),
  E2E_TEST_MODE: '1',
  NODE_ENV: 'development',
  NEXT_PUBLIC_SUPABASE_URL: 'https://CHANGE_ME.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'CHANGE_ME_PUBLIC_ANON_KEY',
  SUPABASE_SERVICE_ROLE_KEY: 'CHANGE_ME_SERVICE_ROLE_KEY',
  SUPABASE_DB_URL: 'CHANGE_ME_DATABASE_URL',
  REDIS_URL: 'CHANGE_ME_REDIS_URL',
  MINIO_ENDPOINT: 'CHANGE_ME_MINIO_HOST',
  MINIO_PORT: '9000',
  MINIO_USE_SSL: 'false',
  MINIO_ACCESS_KEY: 'CHANGE_ME_MINIO_USER',
  MINIO_SECRET_KEY: 'CHANGE_ME_MINIO_PASSWORD',
  MINIO_BUCKET: 'CHANGE_ME_BUCKET',
  APP_URL: 'https://CHANGE_ME.example',
  INGEST_API_KEY: 'CHANGE_ME_INGEST_KEY_24_CHARS',
  AUTH_BYPASS: 'false',
  META_ACCESS_TOKEN: '',
  META_INSTAGRAM_ACCOUNT_ID: '',
  MINIO_PUBLIC_ENDPOINT: '',
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  outputDir: 'work/playwright-results',
  reporter: [['list'], ['html', { outputFolder: 'work/playwright-report', open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: {
    command: `node ../../node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
    cwd: 'apps/web',
    url: `${baseURL}/login`,
    env: isolatedEnv,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
