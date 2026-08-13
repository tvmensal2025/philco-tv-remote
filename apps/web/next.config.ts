import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" }
];

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  transpilePackages: ["@reelops/shared"],
  serverExternalPackages: ["bullmq", "ioredis", "minio"],
  async headers() { return [{ source: "/(.*)", headers: securityHeaders }]; }
};

export default config;
