import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const [file, restaurantId, cameraPosition, capturedAt = new Date().toISOString()] = process.argv.slice(2);
if (!file || !restaurantId || !cameraPosition) {
  console.error("Uso: node scripts/upload-segment.mjs <arquivo.mp4> <restaurant_id> <posição_da_câmera> [timestamp_ISO]");
  process.exit(1);
}
const appUrl = process.env.APP_URL?.replace(/\/$/, "");
const apiKey = process.env.INGEST_API_KEY;
if (!appUrl || !apiKey) throw new Error("APP_URL e INGEST_API_KEY precisam estar no .env");
const fileSize = statSync(file).size;

const authorization = { authorization: `Bearer ${apiKey}` };
const presign = await fetch(`${appUrl}/api/ingest/presign`, {
  method: "POST",
  headers: { ...authorization, "content-type": "application/json" },
  body: JSON.stringify({ restaurantId, cameraPosition: Number(cameraPosition), capturedAt, contentType: "video/mp4" })
});
const ticket = await presign.json();
if (!presign.ok) throw new Error(`Falha ao solicitar upload: ${ticket.error}`);

const upload = await fetch(ticket.uploadUrl, {
  method: "PUT",
  headers: { "content-type": "video/mp4", "content-length": String(fileSize) },
  body: createReadStream(file),
  duplex: "half"
});
if (!upload.ok) throw new Error(`Falha ao enviar ${path.basename(file)}: HTTP ${upload.status}`);

const complete = await fetch(ticket.completeUrl, {
  method: "POST",
  headers: { ...authorization, "content-type": "application/json" },
  body: JSON.stringify({ cameraId: ticket.cameraId, objectPath: ticket.objectPath, capturedAt, expectedBytes: fileSize })
});
const confirmation = await complete.json();
if (!complete.ok) throw new Error(`Upload enviado, mas não confirmado: ${confirmation.error}`);
console.log(`Segmento enviado: ${ticket.objectPath} (${confirmation.size} bytes)`);
