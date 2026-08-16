import {
  FACTORY_BRANDING,
  JOIN_OVERLAY,
  cropNeedsPadBlur,
  isDeliverySourceCrop,
  resolvedJoinOverlay,
  snapPlaybackSpeed,
  takeSourceSeconds,
  type FxBlend,
} from '@reelops/shared';

export type JoinName = 'cut' | 'dissolve' | 'fadeblack' | 'fadein';
export type MotionName = 'none' | 'drift' | 'punch';

export const JOIN = {
  cut: { name: 'fade', duration: 0.04 },
  dissolve: { name: 'fade', duration: 0.58 },
  fadeblack: { name: 'fadeblack', duration: 0.5 },
  fadein: { name: 'fade', duration: 0.04 },
} as const;

export function joinSpec(transition: string, durationSeconds?: number) {
  const base =
    transition === 'dissolve'
      ? JOIN.dissolve
      : transition === 'fadeblack'
        ? JOIN.fadeblack
        : JOIN.cut;
  if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)) {
    let duration = Math.min(1.5, Math.max(0.02, durationSeconds));
    if (transition === 'dissolve') duration = Math.max(0.4, duration);
    if (transition === 'fadeblack') duration = Math.max(0.35, duration);
    return { name: base.name, duration };
  }
  return base;
}

export function joinedDuration(
  scenes: { duration: number; transition: string; joinDuration?: number }[],
) {
  if (!scenes.length) return 0;
  let elapsed = scenes[0]!.duration;
  for (let index = 1; index < scenes.length; index += 1) {
    elapsed +=
      scenes[index]!.duration -
      joinSpec(scenes[index]!.transition, scenes[index]!.joinDuration).duration;
  }
  return Number(elapsed.toFixed(3));
}

type TakeScene = {
  source_start_offset: number;
  duration: number;
  speed?: number;
  fadeIn?: boolean;
  punchIn?: boolean;
  role?: string;
  motion?: MotionName;
  crop?: number[];
  cropMode?: 'crop' | 'pad_blur';
  cropTight?: boolean;
  cropFilter?: string;
  shotStyle?: string;
};

export function takeTrimFilter(scene: TakeScene) {
  const speed = snapPlaybackSpeed(scene.speed ?? 1);
  const source = takeSourceSeconds(scene.duration, speed);
  const trim = `trim=start=${scene.source_start_offset}:duration=${source},setpts=PTS-STARTPTS`;
  if (speed === 1) return trim;
  if (speed < 1) {
    return `${trim},minterpolate=fps=60:mi_mode=mci,setpts=PTS/${speed}`;
  }
  return `${trim},setpts=PTS/${speed}`;
}

export function ffmpegSourceCrop(bbox?: number[] | null, cropFilter?: string) {
  if (cropFilter) return cropFilter.endsWith(',') ? cropFilter : `${cropFilter},`;
  if (!isDeliverySourceCrop(bbox) || !bbox) return '';
  const [x, y, w, h] = bbox.map((value) => Math.round(Number(value)));
  if (![x, y, w, h].every((value) => Number.isFinite(value)) || x < 0 || y < 0) return '';
  const xx = x % 2 === 0 ? x : x - 1;
  const yy = y % 2 === 0 ? y : y - 1;
  const ww = w % 2 === 0 ? w : w - 1;
  const hh = h % 2 === 0 ? h : h - 1;
  if (xx < 0 || yy < 0 || ww < 16 || hh < 16) return '';
  return `crop=${ww}:${hh}:${xx}:${yy},`;
}

const GRADE =
  'eq=contrast=1.06:brightness=0.01:saturation=1.08:gamma=0.99,colorbalance=rs=0.05:gs=0.015:bs=-0.035:rm=0.03:bm=-0.025';

function padBlurGraph(scene: TakeScene, index: number, duration: number, grade: string) {
  const crop = ffmpegSourceCrop(scene.crop).replace(/,$/, '');
  const split = crop ? `${crop},split` : 'split';
  const fadeIn = scene.fadeIn ? ',fade=t=in:st=0:d=0.7:color=black' : '';
  return [
    `[${index}:v]${takeTrimFilter(scene)},${split}[fg${index}][bg${index}]`,
    `[bg${index}]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=16,scale=1080:1920,eq=brightness=-0.08:saturation=0.82[bg${index}b]`,
    `[fg${index}]scale=1080:1920:force_original_aspect_ratio=decrease[fg${index}s]`,
    `[bg${index}b][fg${index}s]overlay=(W-w)/2:(H-h)/2,${grade},fps=30,setsar=1,format=yuv420p${fadeIn}[v${index}]`,
  ].join(';');
}

function lockedVerticalScale(sourceCrop: string) {
  return `${sourceCrop}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;
}

export function takeFilter(scene: TakeScene, index: number) {
  const duration = Math.max(0.8, scene.duration);
  const grade = GRADE;
  if (cropNeedsPadBlur(scene)) return padBlurGraph(scene, index, duration, grade);
  const tight = Boolean(scene.cropTight);
  const motion = tight
    ? 'none'
    : (scene.motion ?? (scene.punchIn ? 'punch' : scene.role === 'ambience' ? 'drift' : 'none'));
  const sourceCrop = ffmpegSourceCrop(scene.crop, scene.cropFilter);
  const reframe =
    motion === 'punch'
      ? `${sourceCrop}scale=1480:2631:force_original_aspect_ratio=increase,crop=1480:2631,scale='1480*(1+0.11*t/${duration})':'2631*(1+0.11*t/${duration})':eval=frame,crop=1080:1920`
      : motion === 'drift'
        ? `${sourceCrop}scale=1296:2304:force_original_aspect_ratio=increase,crop=1296:2304,scale='1296*(1+0.07*t/${duration})':'2304*(1+0.07*t/${duration})':eval=frame,crop=1080:1920`
        : lockedVerticalScale(sourceCrop);
  const fadeIn = scene.fadeIn ? ',fade=t=in:st=0:d=0.7:color=black' : '';
  return `[${index}:v]${takeTrimFilter(scene)},${reframe},${grade},fps=30,setsar=1,format=yuv420p${fadeIn}[v${index}]`;
}

export function takeFilterStatic(scene: TakeScene, index: number) {
  const duration = Math.max(0.8, scene.duration);
  const grade = GRADE;
  if (cropNeedsPadBlur(scene)) return padBlurGraph(scene, index, duration, grade);
  const sourceCrop = ffmpegSourceCrop(scene.crop, scene.cropFilter);
  const style = scene.shotStyle;
  const tight = Boolean(scene.cropTight);
  const punch = tight
    ? lockedVerticalScale(sourceCrop)
    : scene.punchIn || style === 'punch_in'
      ? `${sourceCrop}scale=1240:2204:force_original_aspect_ratio=increase,crop=1080:1920`
      : style === 'slow_push' || style === 'cinematic_food_closeup' || style === 'hero_reveal'
        ? `${sourceCrop}scale=1188:2112:force_original_aspect_ratio=increase,crop=1188:2112,scale='1188*(1+0.055*t/${duration})':'2112*(1+0.055*t/${duration})':eval=frame,crop=1080:1920`
        : lockedVerticalScale(sourceCrop);
  const fadeIn = scene.fadeIn ? ',fade=t=in:st=0:d=0.7:color=black' : '';
  return `[${index}:v]${takeTrimFilter(scene)},${punch},${grade},fps=30,setsar=1,format=yuv420p${fadeIn}[v${index}]`;
}

export function rewrittenJoin(transition: string, profile: 'high' | 'standard' | 'safe' = 'high') {
  if (profile === 'high') return transition;
  if (transition === 'dissolve') return 'cut';
  return transition;
}

/** Casa keeps dissolve xfade even when the encode profile is standard (static takes). */
export function joinProfileFor(
  program: string | undefined,
  encodeProfile: 'high' | 'standard' | 'safe',
): 'high' | 'standard' | 'safe' {
  if (encodeProfile === 'safe') return 'safe';
  if (program === 'casa') return 'high';
  return encodeProfile;
}

export function usesHardCutJoins(
  scenes: { transition: string }[],
  profile: 'high' | 'standard' | 'safe' = 'high',
) {
  if (scenes.length <= 1) return true;
  return scenes.slice(1).every((scene) => {
    const join = rewrittenJoin(scene.transition, profile);
    return join === 'cut' || join === 'fadein';
  });
}

export function concatChain(scenes: { duration: number }[]) {
  const duration = Number(scenes.reduce((sum, scene) => sum + scene.duration, 0).toFixed(3));
  if (scenes.length <= 1) {
    return { filter: '[v0]format=yuv420p[xf]', output: 'xf', duration };
  }
  const labels = scenes.map((_, index) => `[v${index}]`).join('');
  return {
    filter: `${labels}concat=n=${scenes.length}:v=1:a=0[xf]`,
    output: 'xf',
    duration,
  };
}

export function xfadeChain(
  scenes: { duration: number; transition: string; joinDuration?: number }[],
) {
  if (scenes.length === 1)
    return { filter: '[v0]format=yuv420p[xf]', output: 'xf', duration: scenes[0]!.duration };
  const parts: string[] = [];
  let current = 'v0';
  let elapsed = scenes[0]!.duration;
  for (let index = 1; index < scenes.length; index += 1) {
    const spec = joinSpec(scenes[index]!.transition, scenes[index]!.joinDuration);
    const label = index === scenes.length - 1 ? 'xf' : `x${index}`;
    const offset = Math.max(0, Number((elapsed - spec.duration).toFixed(3)));
    parts.push(
      `[${current}][v${index}]xfade=transition=${spec.name}:duration=${spec.duration}:offset=${offset}[${label}]`,
    );
    current = label;
    elapsed = elapsed + scenes[index]!.duration - spec.duration;
  }
  return { filter: parts.join(';'), output: 'xf', duration: Number(elapsed.toFixed(3)) };
}

export function joinOverlayFilter(
  scenes: {
    duration: number;
    transition: string;
    joinDuration?: number;
    joinOverlay?: string;
  }[],
  input = 'xf',
  output = 'ov',
) {
  const hits: { start: number; name: 'flash' | 'leak' | 'burn' }[] = [];
  let elapsed = scenes[0]?.duration ?? 0;
  for (let index = 1; index < scenes.length; index += 1) {
    const spec = joinSpec(scenes[index]!.transition, scenes[index]!.joinDuration);
    const joinStart = Math.max(0, elapsed - spec.duration);
    const raw = scenes[index]!.joinOverlay;
    const overlay =
      raw === 'flash' || raw === 'leak' || raw === 'burn'
        ? resolvedJoinOverlay({ joinOverlay: raw })
        : null;
    if (overlay) {
      const fx = JOIN_OVERLAY[overlay];
      hits.push({
        start: Math.max(0, Number((joinStart + spec.duration / 2 - fx.duration / 2).toFixed(3))),
        name: overlay,
      });
    }
    elapsed = elapsed + scenes[index]!.duration - spec.duration;
  }
  if (!hits.length) return { filter: '', output: input };
  const parts: string[] = [];
  let current = input;
  hits.forEach((hit, index) => {
    const fx = JOIN_OVERLAY[hit.name];
    const fadeOutAt = Number((fx.duration - fx.fadeOut).toFixed(3));
    const src = `fx${index}`;
    const dest = index === hits.length - 1 ? output : `o${index}`;
    parts.push(
      `color=c=${fx.color}:s=1080x1920:d=${fx.duration}:r=30,format=yuva420p,fade=t=in:st=0:d=${fx.fadeIn}:alpha=1,fade=t=out:st=${fadeOutAt}:d=${fx.fadeOut}:alpha=1,setpts=PTS+${hit.start}/TB[${src}]`,
    );
    parts.push(`[${current}][${src}]overlay=0:0:eof_action=pass:format=auto[${dest}]`);
    current = dest;
  });
  return { filter: parts.join(';'), output: current };
}

export type PackOverlayHit = {
  start: number;
  duration: number;
  inputIndex: number;
  blend: FxBlend;
  sceneIndex: number;
};

export function packOverlayFilter(
  hits: PackOverlayHit[],
  input: string,
  output = 'pk',
): { filter: string; output: string } {
  if (!hits.length) return { filter: '', output: input };
  const parts: string[] = [];
  let current = input;
  hits.forEach((hit, index) => {
    const src = `pkfx${index}`;
    const dest = index === hits.length - 1 ? output : `pk${index}`;
    const scaled =
      hit.blend === 'alpha'
        ? `[${hit.inputIndex}:v]format=yuva420p,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setpts=PTS+${hit.start}/TB[${src}]`
        : `[${hit.inputIndex}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setpts=PTS+${hit.start}/TB[${src}]`;
    parts.push(scaled);
    if (hit.blend === 'screen' || hit.blend === 'add') {
      const mode = hit.blend === 'add' ? 'addition' : 'screen';
      parts.push(
        `[${current}][${src}]blend=all_mode=${mode}:shortest=0:enable='between(t,${hit.start},${Number((hit.start + hit.duration).toFixed(3))})'[${dest}]`,
      );
    } else {
      parts.push(`[${current}][${src}]overlay=0:0:eof_action=pass:format=auto[${dest}]`);
    }
    current = dest;
  });
  return { filter: parts.join(';'), output: current };
}

export function joinTimelineStarts(
  scenes: { duration: number; transition: string; joinDuration?: number }[],
) {
  const starts: number[] = [0];
  let elapsed = scenes[0]?.duration ?? 0;
  for (let index = 1; index < scenes.length; index += 1) {
    const spec = joinSpec(scenes[index]!.transition, scenes[index]!.joinDuration);
    starts.push(Math.max(0, elapsed - spec.duration));
    elapsed = elapsed + scenes[index]!.duration - spec.duration;
  }
  return starts;
}

export function masterFinish(
  duration: number,
  fadeOut = true,
  profile: 'high' | 'standard' = 'high',
  input = 'xf',
) {
  const grade =
    profile === 'high'
      ? 'unsharp=5:5:0.55:3:3:0.25,noise=alls=3:allf=t'
      : 'eq=contrast=1.04:saturation=1.06';
  if (!fadeOut || duration < 1.2) return `[${input}]${grade}[basev]`;
  const start = Math.max(0, Number((duration - 0.85).toFixed(3)));
  return `[${input}]${grade},fade=t=out:st=${start}:d=0.85:color=black[basev]`;
}

export function logoOverlayFilter(videoMap: string, logoInputIndex: number) {
  const { x, y, size } = FACTORY_BRANDING.logo;
  return `[${logoInputIndex}:v]format=rgba,scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000[logo];${videoMap}[logo]overlay=${x}:${y}:format=auto[logov]`;
}

export function endCardPlateFilter(videoMap: string, duration: number) {
  const start = Math.max(0, duration - FACTORY_BRANDING.endCard.duration);
  return `color=c=0x0a0a0a@0.72:s=1080x1920:d=${duration},format=yuva420p,fade=t=in:st=${start}:d=0.28:alpha=1[endplate];${videoMap}[endplate]overlay=0:0:enable='gte(t,${start.toFixed(3)})'[endv]`;
}
