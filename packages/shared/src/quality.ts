import { boxInSafeArea, defaultSafeArea } from './crop.js';

export type QualityStatus = 'pending' | 'passed' | 'failed' | 'repairing' | 'needs_review';

export type MediaProbe = {
  sizeBytes: number;
  durationSeconds: number;
  formatName?: string;
  video?: {
    codec?: string;
    width?: number;
    height?: number;
    pixFmt?: string;
    fps?: number;
  };
  audio?: {
    codec?: string;
    sampleRate?: number;
    channels?: number;
  } | null;
};

export type QualityIssue = { code: string; message: string };

export type TechnicalQualityReport = {
  status: QualityStatus;
  issues: QualityIssue[];
  probe: MediaProbe;
};

export type CompositionQualityReport = {
  status: QualityStatus;
  issues: QualityIssue[];
  titleBounds?: { x: number; y: number; w: number; h: number } | null;
  logoBounds?: { x: number; y: number; w: number; h: number } | null;
  ctaBounds?: { x: number; y: number; w: number; h: number } | null;
  safeArea?: { top: number; bottom: number; left: number; right: number };
  assetsLoaded?: string[];
  fontsLoaded?: string[];
  placeholders?: boolean;
  invalidValues?: string[];
  fixtureBranding?: boolean;
};

export type TechnicalRequirements = {
  minSizeBytes?: number;
  minDurationSeconds?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  pixFmt?: string;
  requireAudio?: boolean;
};

export function evaluateTechnicalQuality(
  probe: MediaProbe,
  requirements: TechnicalRequirements = {},
): TechnicalQualityReport {
  const issues: QualityIssue[] = [];
  const minSize = requirements.minSizeBytes ?? 1024;
  const minDuration = requirements.minDurationSeconds ?? 0.4;
  const width = requirements.width ?? 1080;
  const height = requirements.height ?? 1920;
  if (probe.sizeBytes < minSize)
    issues.push({ code: 'EMPTY_FILE', message: 'arquivo vazio ou truncado' });
  if (!(probe.durationSeconds > minDuration))
    issues.push({ code: 'DURATION', message: 'duração inválida' });
  if (!probe.video) issues.push({ code: 'NO_VIDEO_STREAM', message: 'sem stream de vídeo' });
  if (probe.video?.width && probe.video.width !== width)
    issues.push({ code: 'WIDTH', message: `largura ${probe.video.width}` });
  if (probe.video?.height && probe.video.height !== height)
    issues.push({ code: 'HEIGHT', message: `altura ${probe.video.height}` });
  if (
    requirements.videoCodec &&
    probe.video?.codec &&
    probe.video.codec !== requirements.videoCodec
  ) {
    issues.push({ code: 'VIDEO_CODEC', message: String(probe.video.codec) });
  }
  if (requirements.pixFmt && probe.video?.pixFmt && probe.video.pixFmt !== requirements.pixFmt) {
    issues.push({ code: 'PIX_FMT', message: String(probe.video.pixFmt) });
  }
  if (requirements.requireAudio && !probe.audio?.codec)
    issues.push({ code: 'NO_AUDIO', message: 'áudio esperado ausente' });
  return { status: issues.length ? 'failed' : 'passed', issues, probe };
}

export type CompositionCheckInput = {
  title?: string | null;
  titleBox?: { x: number; y: number; w: number; h: number } | null;
  logoBox?: { x: number; y: number; w: number; h: number } | null;
  ctaBox?: { x: number; y: number; w: number; h: number } | null;
  showLogo?: boolean;
  logoPresent?: boolean;
  assetsMissing?: string[];
  assetsLoaded?: string[];
  fontsLoaded?: string[];
  fixtureBranding?: boolean;
  frame?: { width: number; height: number };
  safeArea?: { top: number; bottom: number; left: number; right: number };
};

export function evaluateCompositionQuality(input: CompositionCheckInput): CompositionQualityReport {
  const issues: QualityIssue[] = [];
  const frame = input.frame ?? { width: 1080, height: 1920 };
  const safe = input.safeArea ?? defaultSafeArea;
  if (input.title && /change.?me|lorem|placeholder/i.test(input.title)) {
    issues.push({ code: 'PLACEHOLDER_TEXT', message: 'título placeholder' });
  }
  if (input.titleBox && !boxInSafeArea(input.titleBox, frame, safe)) {
    issues.push({ code: 'TITLE_OVERFLOW', message: 'título fora da safe area' });
  }
  if (input.showLogo && input.logoPresent === false) {
    issues.push({ code: 'MISSING_LOGO', message: 'logo esperado ausente' });
  }
  if (input.logoBox && !boxInSafeArea(input.logoBox, frame, safe)) {
    issues.push({ code: 'LOGO_SAFE_AREA', message: 'logo fora da safe area' });
  }
  if (input.ctaBox && !boxInSafeArea(input.ctaBox, frame, safe)) {
    issues.push({ code: 'CTA_OVERFLOW', message: 'CTA fora da safe area' });
  }
  for (const asset of input.assetsMissing ?? []) {
    issues.push({ code: 'MISSING_ASSET', message: asset });
  }
  return {
    status: issues.length ? 'failed' : 'passed',
    issues,
    titleBounds: input.titleBox ?? null,
    logoBounds: input.logoBox ?? null,
    ctaBounds: input.ctaBox ?? null,
    safeArea: safe,
    assetsLoaded: input.assetsLoaded ?? [],
    fontsLoaded: input.fontsLoaded ?? [],
    placeholders: issues.some((issue) => issue.code === 'PLACEHOLDER_TEXT'),
    invalidValues: [],
    fixtureBranding: input.fixtureBranding === true,
  };
}
