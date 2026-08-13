import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const envDefaults = {
  REDIS_URL: "redis://localhost:6379",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "validation-service-key",
  MINIO_ENDPOINT: "localhost",
  MINIO_ACCESS_KEY: "test",
  MINIO_SECRET_KEY: "test-secret",
  MINIO_BUCKET: "restaurant-media"
};
Object.entries(envDefaults).forEach(([key, value]) => process.env[key] ||= value);

const directory = await mkdtemp(path.join(tmpdir(), "reelops-smoke-"));
process.env.WORK_DIR = directory;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let error = "";
    child.stderr.on("data", (data) => error += data);
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} (${code}): ${error}`)));
  });
}

try {
  const colors = ["red", "blue", "green", "yellow"];
  const candidates = [];
  for (let index = 0; index < colors.length; index++) {
    const clip = path.join(directory, `camera-${index + 1}.mp4`);
    const inputs = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${colors[index]}:s=640x360:d=6`];
    if (index === 0) inputs.push("-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:a", "aac", "-shortest");
    inputs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", clip);
    await run("ffmpeg", inputs);
    const manifest = path.join(directory, `camera-${index + 1}.txt`);
    await writeFile(manifest, `file '${clip.replaceAll("\\", "/")}'\n`, "utf8");
    candidates.push({ cameraId: String(index + 1), path: clip, localPath: manifest, position: index + 1, startOffsetSeconds: 0, hasAudio: index === 0 });
  }
  const { renderVertical, probeDuration, hasAudioStream } = await import("../apps/worker/dist/pipeline/ffmpeg.js");
  const output = path.join(directory, "result.mp4");
  await renderVertical(candidates, 4, output);
  const duration = await probeDuration(output);
  const hasAudio = await hasAudioStream(output);
  if (duration < 3.8 || duration > 4.2) throw new Error(`Duração inesperada: ${duration}`);
  if (!hasAudio) throw new Error("O áudio da câmera não foi preservado");
  console.log(`Pipeline de vídeo aprovado: ${duration.toFixed(2)}s, 1080x1920, áudio preservado.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
