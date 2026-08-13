import { spawn } from "node:child_process";
import type { ClipCandidate } from "../adapters/analyzer.js";
import { config } from "../config.js";

async function run(binary: string, args: string[], timeoutMs = 15 * 60 * 1000) {
  return new Promise<string>((resolve, reject) => {
    const process = spawn(binary, args);
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => { process.kill("SIGKILL"); reject(new Error(`${binary.toUpperCase()}_TIMEOUT`)); }, timeoutMs);
    process.stdout.on("data", (data) => stdout += data);
    process.stderr.on("data", (data) => stderr += data);
    process.on("error", (error) => { clearTimeout(timeout); reject(error); });
    process.on("close", (code) => { clearTimeout(timeout); code === 0 ? resolve(stdout) : reject(new Error(`${binary} (${code}): ${stderr.slice(-1800)}`)); });
  });
}

export async function hasAudioStream(input: string) {
  const output = await run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", input], 30_000);
  return output.trim() === "audio";
}

export async function renderVertical(clips: ClipCandidate[], duration: number, output: string) {
  if (!clips.length) throw new Error("NO_CAMERA_SEGMENTS");
  const selected = clips.slice(0, 8);
  const clipDuration = duration / selected.length;
  const args: string[] = ["-hide_banner", "-loglevel", "error", "-y"];
  selected.forEach((clip) => args.push("-f", "concat", "-safe", "0", "-i", clip.localPath));

  const videoFilters = selected.map((clip, index) => {
    const start = clip.startOffsetSeconds + index * clipDuration;
    return `[${index}:v]trim=start=${start}:duration=${clipDuration},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v${index}]`;
  });
  const filters = [...videoFilters, `${selected.map((_, index) => `[v${index}]`).join("")}concat=n=${selected.length}:v=1:a=0[outv]`];
  const audioSource = selected.findIndex((clip) => clip.hasAudio);
  if (audioSource >= 0) {
    const offset = selected[audioSource].startOffsetSeconds;
    filters.push(`[${audioSource}:a]atrim=start=${offset}:duration=${duration},asetpts=PTS-STARTPTS,aresample=async=1[outa]`);
  }

  args.push("-filter_complex", filters.join(";"), "-map", "[outv]");
  if (audioSource >= 0) args.push("-map", "[outa]", "-c:a", "aac", "-b:a", "128k"); else args.push("-an");
  args.push("-c:v", "libx264", "-preset", config.FFMPEG_PRESET, "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output);
  await run("ffmpeg", args);
}

export async function makeThumbnail(input: string, output: string) { await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", input, "-frames:v", "1", "-vf", "scale=540:960", output], 60_000); }

export async function probeDuration(input: string) {
  const output = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input], 30_000);
  const duration = Number(output.trim());
  if (!Number.isFinite(duration)) throw new Error("INVALID_OUTPUT_DURATION");
  return duration;
}
