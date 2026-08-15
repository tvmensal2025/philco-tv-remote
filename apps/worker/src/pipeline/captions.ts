import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { FACTORY_BRANDING, FACTORY_LIMITS } from '@reelops/shared';

function assEscape(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\N')
    .replace(/[{}]/g, '')
    .replace(/,/g, '\\,');
}

export type ProgramAssCopy = {
  caption?: string | null;
  title?: string | null;
  lowerThird?: string | null;
  cta?: string | null;
  endCard?: string | null;
  wordmark?: string | null;
};

export async function writeCaptionAss(dir: string, caption: string, durationSeconds: number) {
  return writeProgramAss(dir, durationSeconds, { caption });
}

export async function writeProgramAss(dir: string, durationSeconds: number, copy: ProgramAssCopy) {
  const events: string[] = [];
  const duration = Math.max(2, durationSeconds);
  const endStart = Math.max(0, duration - FACTORY_BRANDING.endCard.duration);

  const caption = copy.caption?.trim();
  if (caption) {
    const end = Math.min(FACTORY_LIMITS.captionSeconds, duration);
    events.push(dialogue('Caption', 0.4, end, assEscape(caption.slice(0, 180))));
  }
  const title = copy.title?.trim();
  if (title) {
    const end = Math.min(FACTORY_BRANDING.title.start + FACTORY_BRANDING.title.duration, endStart);
    if (end > FACTORY_BRANDING.title.start) {
      events.push(
        dialogue('Title', FACTORY_BRANDING.title.start, end, assEscape(title.slice(0, 42))),
      );
    }
  }
  const wordmark = copy.wordmark?.trim();
  if (wordmark) {
    events.push(dialogue('Wordmark', 0.2, endStart || duration, assEscape(wordmark.slice(0, 12))));
  }
  const lower = copy.lowerThird?.trim();
  if (lower) {
    const end = Math.min(
      FACTORY_BRANDING.lowerThird.start + FACTORY_BRANDING.lowerThird.duration,
      endStart || duration,
    );
    if (end > FACTORY_BRANDING.lowerThird.start) {
      events.push(
        dialogue('Lower', FACTORY_BRANDING.lowerThird.start, end, assEscape(lower.slice(0, 48))),
      );
    }
  }
  const cta = copy.cta?.trim();
  if (cta) {
    const start = Math.max(0, duration - FACTORY_BRANDING.cta.tail);
    const end = endStart > start ? endStart : duration;
    if (end > start) {
      events.push(dialogue('Cta', start, end, assEscape(cta.slice(0, 40))));
    }
  }
  const endCard = copy.endCard?.trim();
  if (endCard && endStart < duration) {
    events.push(dialogue('EndCard', endStart, duration, assEscape(endCard.slice(0, 42))));
  }
  if (!events.length) return null;

  const content = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,70,70,140,1
Style: Title,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,4,0,8,90,90,${FACTORY_BRANDING.title.y},1
Style: Wordmark,Arial,28,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,2,0,7,${FACTORY_BRANDING.logo.x},${FACTORY_BRANDING.logo.x},${FACTORY_BRANDING.logo.y},1
Style: Lower,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,3,0,0,1,${FACTORY_BRANDING.lowerThird.x},200,${FACTORY_BRANDING.lowerThird.bottom},1
Style: Cta,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,3,0,0,2,90,90,${FACTORY_BRANDING.cta.bottom},1
Style: EndCard,Arial,70,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,70,70,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
  const file = path.join(dir, 'caption.ass');
  await writeFile(file, content, 'utf8');
  return file;
}

function dialogue(style: string, start: number, end: number, text: string) {
  return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},${style},,0,0,0,,${text}`;
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
