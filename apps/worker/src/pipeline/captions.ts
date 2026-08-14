import path from 'node:path';
import { writeFile } from 'node:fs/promises';

function assEscape(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\N')
    .replace(/[{}]/g, '')
    .replace(/,/g, '\\,');
}

export async function writeCaptionAss(dir: string, caption: string, durationSeconds: number) {
  const clean = caption.trim();
  if (!clean) return null;
  const end = formatAssTime(Math.max(2, Math.min(durationSeconds, 8)));
  const dialogue = assEscape(clean.slice(0, 180));
  const content = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,70,70,140,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.40,${end},Default,,0,0,0,,${dialogue}
`;
  const file = path.join(dir, 'caption.ass');
  await writeFile(file, content, 'utf8');
  return file;
}

function formatAssTime(seconds: number) {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const whole = Math.floor(secs);
  const cs = Math.round((secs - whole) * 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function ffmpegSubtitlesFilter(assPath: string) {
  const escaped = assPath.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
  return `subtitles='${escaped}'`;
}
