import { JOIN_OVERLAY, resolvedJoinOverlay } from '@reelops/shared';

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

export function ffmpegSourceCrop(bbox?: number[] | null) {
  if (!bbox || bbox.length !== 4) return '';
  const [x, y, w, h] = bbox.map((value) => Math.round(Number(value)));
  if (![x, y, w, h].every((value) => Number.isFinite(value)) || x < 0 || y < 0 || w < 16 || h < 16)
    return '';
  return `crop=${w}:${h}:${x}:${y},`;
}

export function takeFilter(
  scene: {
    source_start_offset: number;
    duration: number;
    fadeIn?: boolean;
    punchIn?: boolean;
    role?: string;
    motion?: MotionName;
    crop?: number[];
  },
  index: number,
) {
  const duration = Math.max(0.8, scene.duration);
  const motion =
    scene.motion ?? (scene.punchIn ? 'punch' : scene.role === 'ambience' ? 'drift' : 'none');
  const sourceCrop = ffmpegSourceCrop(scene.crop);
  // HIGH profile: eval=frame Ken Burns at 1480×2631 / 1296×2304 plus xfade is the KVM4 OOM path.
  const reframe =
    motion === 'punch'
      ? `${sourceCrop}scale=1480:2631:force_original_aspect_ratio=increase,crop=1480:2631,scale='1480*(1+0.11*t/${duration})':'2631*(1+0.11*t/${duration})':eval=frame,crop=1080:1920`
      : motion === 'drift'
        ? `${sourceCrop}scale=1296:2304:force_original_aspect_ratio=increase,crop=1296:2304,scale='1296*(1+0.07*t/${duration})':'2304*(1+0.07*t/${duration})':eval=frame,crop=1080:1920`
        : `${sourceCrop}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;
  const fadeIn = scene.fadeIn ? ',fade=t=in:st=0:d=0.7:color=black' : '';
  return `[${index}:v]trim=start=${scene.source_start_offset}:duration=${duration},setpts=PTS-STARTPTS,${reframe},eq=contrast=1.08:brightness=0.028:saturation=1.14:gamma=0.98,colorbalance=rs=0.06:gs=0.02:bs=-0.045:rm=0.035:bm=-0.03,fps=30,setsar=1,format=yuv420p${fadeIn}[v${index}]`;
}

export function takeFilterStatic(
  scene: {
    source_start_offset: number;
    duration: number;
    fadeIn?: boolean;
    punchIn?: boolean;
    crop?: number[];
  },
  index: number,
) {
  const duration = Math.max(0.8, scene.duration);
  const sourceCrop = ffmpegSourceCrop(scene.crop);
  const punch = scene.punchIn
    ? `${sourceCrop}scale=1240:2204:force_original_aspect_ratio=increase,crop=1080:1920`
    : `${sourceCrop}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;
  const fadeIn = scene.fadeIn ? ',fade=t=in:st=0:d=0.7:color=black' : '';
  return `[${index}:v]trim=start=${scene.source_start_offset}:duration=${duration},setpts=PTS-STARTPTS,${punch},eq=contrast=1.08:brightness=0.028:saturation=1.14:gamma=0.98,fps=30,setsar=1,format=yuv420p${fadeIn}[v${index}]`;
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
