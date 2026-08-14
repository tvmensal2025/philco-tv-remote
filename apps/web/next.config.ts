import type { NextConfig } from 'next';
import { loadRootEnv } from './lib/load-root-env';

loadRootEnv();

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  output: 'standalone',
  distDir: process.env.E2E_TEST_MODE === '1' ? '.next-e2e' : '.next',
  env: {
    E2E_TEST_MODE: process.env.E2E_TEST_MODE ?? '',
  },
  poweredByHeader: false,
  compress: true,
  transpilePackages: ['@reelops/shared'],
  serverExternalPackages: ['bullmq', 'ioredis', 'minio'],
  experimental: {
    serverActions: { bodySizeLimit: '256mb' },
    proxyClientMaxBodySize: '256mb',
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  async redirects() {
    return [
      { source: '/automation', destination: '/estudio?tab=sozinho', permanent: false },
      { source: '/rules', destination: '/estudio?tab=prioridade', permanent: false },
      { source: '/styles', destination: '/estudio?tab=ritmo', permanent: false },
    ];
  },
};

export default config;
