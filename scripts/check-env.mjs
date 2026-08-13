import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "REDIS_URL", "MINIO_ENDPOINT", "MINIO_PORT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_BUCKET", "APP_URL", "INGEST_API_KEY"];
const invalid = required.filter((key) => { const value = process.env[key]?.trim(); return !value || /CHANGE_ME|replace-me|YOUR_/i.test(value); });
if (invalid.length) {
  console.error(`Configuração incompleta:\n- ${invalid.join("\n- ")}`);
  process.exit(1);
}
if ((process.env.INGEST_API_KEY ?? "").length < 24) {
  console.error("INGEST_API_KEY precisa ter pelo menos 24 caracteres.");
  process.exit(1);
}
console.log("Configuração essencial preenchida. Agora execute: docker compose up -d --build");
