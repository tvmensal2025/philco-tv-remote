import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    settings: {
      next: {
        rootDir: 'apps/web/',
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  globalIgnores([
    '**/.next/**',
    '**/dist/**',
    'node_modules/**',
    'outputs/**',
    'work/**',
    'tmp/**',
    'generated/**',
    'playwright-report/**',
    'test-results/**',
    '**/next-env.d.ts',
    '**/*.tsbuildinfo',
  ]),
]);
