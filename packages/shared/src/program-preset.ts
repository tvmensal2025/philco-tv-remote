import { z } from 'zod';
import { takeCountForDuration } from './reel-duration.js';

const cameraRoles = ['master', 'side', 'food', 'ambience'] as const;
const editPrograms = ['casa', 'oficio', 'assinatura', 'pulso'] as const;
type CameraRole = (typeof cameraRoles)[number];
type EditProgram = (typeof editPrograms)[number];

export const joinNames = ['cut', 'dissolve', 'fadeblack'] as const;
export type JoinName = (typeof joinNames)[number];

export const joinOverlayNames = ['none', 'flash', 'leak', 'burn'] as const;
export type JoinOverlayName = (typeof joinOverlayNames)[number];
export type JoinOverlayKind = Exclude<JoinOverlayName, 'none'>;

export const motionNames = ['none', 'drift', 'punch'] as const;
export type MotionName = (typeof motionNames)[number];

export const programCaptionStrategies = ['none', 'full'] as const;

export const programBrandingSchema = z.object({
  title: z.boolean().default(false),
  logo: z.boolean().default(false),
  lowerThird: z.boolean().default(false),
  cta: z.boolean().default(false),
  endCard: z.boolean().default(false),
});
export type ProgramBranding = z.infer<typeof programBrandingSchema>;

export const emptyProgramBranding: ProgramBranding = {
  title: false,
  logo: false,
  lowerThird: false,
  cta: false,
  endCard: false,
};

const programShortLabels: Record<EditProgram, string> = {
  casa: 'Casa',
  oficio: 'Ofício',
  assinatura: 'Assinatura',
  pulso: 'Pulso',
};

export const brandingLayerLabels: Record<keyof ProgramBranding, string> = {
  title: 'Título',
  logo: 'Logo',
  lowerThird: 'Lower third',
  cta: 'CTA',
  endCard: 'End card',
};

export function defaultBrandingFor(program: EditProgram): ProgramBranding {
  return {
    title: true,
    logo: true,
    lowerThird: program === 'oficio',
    cta: program === 'pulso',
    endCard: true,
  };
}

export function brandWordmark(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return parts
      .slice(0, 2)
      .map((part) => part[0] ?? '')
      .join('')
      .toUpperCase();
  }
  return name.trim().slice(0, 12);
}

export function programBrandCopy(input: {
  restaurantName: string;
  program: EditProgram;
  cta?: string | null;
}) {
  const name = input.restaurantName.trim() || programShortLabels[input.program];
  const cta = input.cta?.trim().slice(0, 40) || 'Peça no salão';
  return {
    title: name.slice(0, 42),
    lowerThird: `${programShortLabels[input.program]} · ${name}`.slice(0, 48),
    cta,
    endCard: name.slice(0, 42),
    wordmark: brandWordmark(name),
  };
}

export const playbookBeatSchema = z.object({
  name: z.string().trim().min(1).max(40),
  roles: z.array(z.enum(cameraRoles)).min(1).max(4),
  durationSeconds: z.number().min(0.8).max(18),
  reason: z.string().trim().min(1).max(160),
  join: z.enum(joinNames),
  joinDurationSeconds: z.number().min(0.02).max(1.5).optional(),
  joinOverlay: z.enum(joinOverlayNames).optional(),
  fxAssetId: z.string().trim().min(1).max(80).optional(),
  fxMode: z.enum(['none', 'auto']).optional(),
  fadeIn: z.boolean().optional(),
  fadeOut: z.boolean().optional(),
  punchIn: z.boolean().optional(),
  motion: z.enum(motionNames).optional(),
  preferPeak: z.boolean().optional(),
});
export type PlaybookBeat = z.infer<typeof playbookBeatSchema>;

export const programPresetSpecSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    program: z.enum(editPrograms),
    join: z.enum(['cut', 'dissolve']),
    targetDuration: z.number().min(8).max(90),
    maxShare: z.number().min(0.15).max(0.9),
    minRoles: z.number().int().min(1).max(4),
    beats: z.array(playbookBeatSchema).min(3).max(12),
    captions: z
      .object({
        strategy: z.enum(programCaptionStrategies),
      })
      .default({ strategy: 'full' }),
    branding: programBrandingSchema.optional(),
  })
  .transform((spec) => ({
    ...spec,
    branding: spec.branding ?? defaultBrandingFor(spec.program),
  }));
export type ProgramPresetSpec = z.infer<typeof programPresetSpecSchema>;

export type Playbook = {
  program: EditProgram;
  join: 'cut' | 'dissolve';
  targetDuration: number;
  maxShare: number;
  minRoles: number;
  beats: PlaybookBeat[];
  captions: { strategy: 'none' | 'full' };
  branding: ProgramBranding;
};

export const joinLabels: Record<JoinName, string> = {
  cut: 'Corte seco',
  dissolve: 'Dissolve',
  fadeblack: 'Fade a preto',
};

export const JOIN_DEFAULT_SECONDS: Record<JoinName, number> = {
  cut: 0.04,
  dissolve: 0.58,
  fadeblack: 0.5,
};

/** Owned Sofia Veo beds are ~59s; Reels now scale to 15/30/45/60 instead of locking here. */
export const MUSIC_BED_SECONDS = 59;

export function fitBeatsToTarget(beats: PlaybookBeat[], target: number): PlaybookBeat[] {
  return fitBeatsToMusicBed(beats, target);
}

export const joinOverlayLabels: Record<JoinOverlayName, string> = {
  none: 'Sem FX',
  flash: 'Flash',
  leak: 'Light leak',
  burn: 'Film burn',
};

export const JOIN_OVERLAY: Record<
  JoinOverlayKind,
  {
    duration: number;
    fadeIn: number;
    fadeOut: number;
    peak: number;
    color: string;
    preview: string;
  }
> = {
  flash: {
    duration: 0.24,
    fadeIn: 0.04,
    fadeOut: 0.14,
    peak: 0.88,
    color: '0xFFFFFF@0.82',
    preview: 'radial-gradient(circle at 50% 45%, #ffffff 0%, #fff6e8 38%, transparent 72%)',
  },
  leak: {
    duration: 0.55,
    fadeIn: 0.14,
    fadeOut: 0.28,
    peak: 0.55,
    color: '0xFF7A18@0.48',
    preview:
      'radial-gradient(ellipse at 8% 6%, #ffd7a0 0%, #ff7a18 26%, transparent 58%), radial-gradient(ellipse at 88% 18%, #ffb060 0%, transparent 48%)',
  },
  burn: {
    duration: 0.42,
    fadeIn: 0.08,
    fadeOut: 0.22,
    peak: 0.72,
    color: '0xFFE0C0@0.7',
    preview:
      'radial-gradient(ellipse at 82% -8%, #fff8ee 0%, #ffb060 22%, #c2410c 44%, #450a0a 58%, transparent 72%), linear-gradient(180deg, rgba(255,230,180,0.55) 0%, transparent 28%)',
  },
};

export function resolvedJoinOverlay(beat: {
  joinOverlay?: JoinOverlayName;
}): JoinOverlayKind | null {
  if (beat.joinOverlay === 'flash' || beat.joinOverlay === 'leak' || beat.joinOverlay === 'burn')
    return beat.joinOverlay;
  return null;
}

export const motionLabels: Record<MotionName, string> = {
  none: 'Estático — o plano não mexe',
  drift: 'Zoom lento — sala / ambiente',
  punch: 'Zoom no prato — close',
};

export const cameraRoleLabels: Record<CameraRole, string> = {
  master: 'Balcão',
  side: 'Ofício',
  food: 'Prato',
  ambience: 'Sala',
};

export type EffectStatus = 'real' | 'architecture';

export type CatalogEffect = {
  id: string;
  group: 'transicao' | 'motion' | 'take' | 'legenda' | 'overlay';
  label: string;
  status: EffectStatus;
  hint: string;
  apply?: Partial<
    Pick<
      PlaybookBeat,
      | 'join'
      | 'joinDurationSeconds'
      | 'joinOverlay'
      | 'motion'
      | 'punchIn'
      | 'fadeIn'
      | 'fadeOut'
      | 'fxAssetId'
      | 'fxMode'
      | 'preferPeak'
    >
  >;
  applyBranding?: Partial<ProgramBranding>;
};

export const renderEffectCatalog: CatalogEffect[] = [
  {
    id: 'cut',
    group: 'transicao',
    label: 'Corte seco',
    status: 'real',
    hint: 'xfade fade 0,04s — o corte do Pulso',
    apply: { join: 'cut', joinDurationSeconds: 0.04 },
  },
  {
    id: 'dissolve',
    group: 'transicao',
    label: 'Dissolve',
    status: 'real',
    hint: 'xfade fade ≥0,4s — mix por cima, sem mergulho a preto',
    apply: { join: 'dissolve', joinDurationSeconds: 0.58 },
  },
  {
    id: 'fadeblack',
    group: 'transicao',
    label: 'Fade a preto',
    status: 'real',
    hint: 'xfade fadeblack ≥0,35s — insert e saída',
    apply: { join: 'fadeblack', joinDurationSeconds: 0.5 },
  },
  {
    id: 'directional_push',
    group: 'transicao',
    label: 'Push direcional',
    status: 'architecture',
    hint: 'No contrato VideoEditDecision; o FFmpeg ainda não executa',
  },
  {
    id: 'masked_reveal',
    group: 'transicao',
    label: 'Reveal com máscara',
    status: 'architecture',
    hint: 'No contrato; o render atual não aplica máscara',
  },
  {
    id: 'motion-none',
    group: 'motion',
    label: 'Estático',
    status: 'real',
    hint: 'Crop 1080×1920 sem Ken Burns',
    apply: { motion: 'none' },
  },
  {
    id: 'drift',
    group: 'motion',
    label: 'Drift',
    status: 'real',
    hint: 'Ken Burns lento — perfil HIGH',
    apply: { motion: 'drift' },
  },
  {
    id: 'punch',
    group: 'motion',
    label: 'Punch',
    status: 'real',
    hint: 'Zoom no pico — perfil HIGH',
    apply: { motion: 'punch', punchIn: true },
  },
  {
    id: 'slow_pull',
    group: 'motion',
    label: 'Pull-out',
    status: 'architecture',
    hint: 'Listado em video-decision; takeFilter não implementa',
  },
  {
    id: 'freeze_emphasis',
    group: 'motion',
    label: 'Freeze',
    status: 'architecture',
    hint: 'Listado em video-decision; não há freeze no FFmpeg',
  },
  {
    id: 'punch-in',
    group: 'take',
    label: 'Punch-in (crop)',
    status: 'real',
    hint: 'Crop mais fechado mesmo no perfil STANDARD',
    apply: { punchIn: true },
  },
  {
    id: 'fade-in',
    group: 'take',
    label: 'Fade in',
    status: 'real',
    hint: 'Abre o take do preto, 0,7s',
    apply: { fadeIn: true },
  },
  {
    id: 'fade-out',
    group: 'take',
    label: 'Fade out',
    status: 'real',
    hint: 'Fecha o programa no masterFinish',
    apply: { fadeOut: true },
  },
  {
    id: 'prefer-peak',
    group: 'take',
    label: 'Cortar no pico',
    status: 'real',
    hint: 'RecordingLocator + snapTake no pico de cena/áudio',
    apply: { preferPeak: true },
  },
  {
    id: 'captions-full',
    group: 'legenda',
    label: 'Legenda do turno',
    status: 'real',
    hint: 'ASS 1080×1920 por 8s se a visão devolver caption',
  },
  {
    id: 'captions-none',
    group: 'legenda',
    label: 'Sem legenda',
    status: 'real',
    hint: 'Não queima ASS no MP4',
  },
  {
    id: 'speech-only',
    group: 'legenda',
    label: 'Legenda da fala',
    status: 'architecture',
    hint: 'Sem STT no worker; não oferecemos como se existisse',
  },
  {
    id: 'overlay-flash',
    group: 'overlay',
    label: 'Flash no join',
    status: 'real',
    hint: 'Branco com alpha no meio do xfade — corta ou dissolve por baixo',
    apply: { joinOverlay: 'flash' },
  },
  {
    id: 'overlay-leak',
    group: 'overlay',
    label: 'Light leak',
    status: 'real',
    hint: 'Vazamento quente transparente centrado no join',
    apply: { joinOverlay: 'leak' },
  },
  {
    id: 'overlay-burn',
    group: 'overlay',
    label: 'Film burn',
    status: 'real',
    hint: 'Queima de filme no meio da transição',
    apply: { joinOverlay: 'burn' },
  },
  {
    id: 'overlay-none',
    group: 'overlay',
    label: 'Sem FX no join',
    status: 'real',
    hint: 'Tira o overlay; o cut/dissolve continua',
    apply: { joinOverlay: 'none' },
  },
  {
    id: 'overlay-alpha-pack',
    group: 'overlay',
    label: 'Pack WebM alpha',
    status: 'real',
    hint: 'MOV/WebM do catálogo (assets/fx) no join — alpha, screen ou add',
  },
  {
    id: 'title',
    group: 'overlay',
    label: 'Título',
    status: 'real',
    hint: 'ASS no topo 3,4s — nome do restaurante, Arial 72',
    applyBranding: { title: true },
  },
  {
    id: 'logo',
    group: 'overlay',
    label: 'Logo',
    status: 'real',
    hint: 'PNG do parceiro no canto (90,250); sem ficheiro, wordmark ASS',
    applyBranding: { logo: true },
  },
  {
    id: 'lower-third',
    group: 'overlay',
    label: 'Lower third',
    status: 'real',
    hint: 'Faixa ASS com o programa e o nome, 6,5s',
    applyBranding: { lowerThird: true },
  },
  {
    id: 'cta',
    group: 'overlay',
    label: 'CTA',
    status: 'real',
    hint: 'ASS acima da legenda nos últimos 4s — CTA do restaurante ou “Peça no salão”',
    applyBranding: { cta: true },
  },
  {
    id: 'end-card',
    group: 'overlay',
    label: 'End card',
    status: 'real',
    hint: 'Placa escura 1,55s no fecho com o nome do restaurante',
    applyBranding: { endCard: true },
  },
];

export function joinedPlaybookSeconds(beats: PlaybookBeat[]) {
  if (!beats.length) return 0;
  let elapsed = beats[0]!.durationSeconds;
  for (let index = 1; index < beats.length; index += 1) {
    const beat = beats[index]!;
    const overlap = beat.joinDurationSeconds ?? JOIN_DEFAULT_SECONDS[beat.join];
    elapsed += beat.durationSeconds - overlap;
  }
  return Number(elapsed.toFixed(3));
}

function fillTakes(beats: PlaybookBeat[], takeCount: number): PlaybookBeat[] {
  if (beats.length >= takeCount) return beats.map((beat) => ({ ...beat }));
  const first = { ...beats[0]! };
  const last = { ...beats[beats.length - 1]!, fadeOut: true };
  const mids = beats.slice(1, -1).map((beat) => ({ ...beat, fadeIn: false, fadeOut: false }));
  if (!mids.length) {
    mids.push({ ...first, fadeIn: false, fadeOut: false, name: `${first.name}-loop`.slice(0, 40) });
  }
  const out: PlaybookBeat[] = [first];
  let cycle = 0;
  while (out.length < takeCount - 1) {
    const src = mids[cycle % mids.length]!;
    out.push({ ...src, name: `${src.name}-${out.length}`.slice(0, 40) });
    cycle += 1;
  }
  out.push(last);
  return out;
}

export function fitBeatsToMusicBed(
  beats: PlaybookBeat[],
  target = MUSIC_BED_SECONDS,
): PlaybookBeat[] {
  let next = beats.map((beat) => ({ ...beat }));
  for (let guard = 0; guard < 8; guard += 1) {
    const current = joinedPlaybookSeconds(next);
    const factor = current > 0 ? target / current : 1;
    next = next.map((beat) => ({
      ...beat,
      durationSeconds: Number(
        Math.min(18, Math.max(0.8, beat.durationSeconds * factor)).toFixed(3),
      ),
    }));
    const got = joinedPlaybookSeconds(next);
    if (got > target + 0.25) {
      const shrink = target / got;
      next = next.map((beat) => ({
        ...beat,
        durationSeconds: Number(Math.max(0.8, beat.durationSeconds * shrink).toFixed(3)),
      }));
    }
    const fitted = joinedPlaybookSeconds(next);
    if (Math.abs(fitted - target) <= 1.5 || next.length >= 12) return next;
    if (fitted >= target - 1.5) return next;
    const mid = next[Math.min(1, Math.max(0, next.length - 2))]!;
    next.splice(next.length - 1, 0, {
      ...mid,
      fadeIn: false,
      fadeOut: false,
      name: `${mid.name}-${next.length}`.slice(0, 40),
    });
  }
  return next;
}

function spec(
  program: EditProgram,
  join: 'cut' | 'dissolve',
  _targetDuration: number,
  maxShare: number,
  minRoles: number,
  beats: PlaybookBeat[],
): ProgramPresetSpec {
  return programPresetSpecSchema.parse({
    schemaVersion: '1.0',
    program,
    join,
    targetDuration: Math.max(8, Math.min(90, Math.round(joinedPlaybookSeconds(beats)) || 30)),
    maxShare,
    minRoles,
    beats,
    captions: { strategy: 'full' },
    branding: defaultBrandingFor(program),
  });
}

const pulsoRoles: CameraRole[][] = [
  ['ambience'],
  ['master'],
  ['side'],
  ['food'],
  ['master'],
  ['side'],
  ['ambience'],
  ['food'],
];

export const validatedProgramPresets: Record<EditProgram, ProgramPresetSpec> = {
  casa: spec('casa', 'dissolve', 59, 0.9, 1, [
    {
      name: 'gancho',
      roles: ['food', 'master', 'ambience', 'side'],
      durationSeconds: 12,
      reason: 'Palco inteiro: a melhor câmera ganha, role é só prior',
      join: 'dissolve',
      fadeIn: true,
      motion: 'none',
      preferPeak: true,
    },
    {
      name: 'servico',
      roles: ['master', 'food'],
      durationSeconds: 12,
      reason: 'Continuidade da ação no mesmo palco',
      join: 'dissolve',
      motion: 'none',
      preferPeak: true,
    },
    {
      name: 'oficio',
      roles: ['master', 'food', 'side'],
      durationSeconds: 12,
      reason: 'Mesma cena, sem close nem fade a preto',
      join: 'dissolve',
      motion: 'none',
      preferPeak: true,
    },
    {
      name: 'verso',
      roles: ['food', 'master'],
      durationSeconds: 12,
      reason: 'Segundo take longo; crop só se esta caixa estiver em pé agora',
      join: 'dissolve',
      motion: 'none',
      preferPeak: true,
    },
    {
      name: 'saida',
      roles: ['master', 'food', 'ambience'],
      durationSeconds: 12,
      reason: 'Saída na câmera que conta a história, ainda em dissolve',
      join: 'dissolve',
      fadeOut: true,
      motion: 'none',
      preferPeak: true,
    },
  ]),
  oficio: spec('oficio', 'cut', 20, 0.65, 2, [
    {
      name: 'gancho',
      roles: ['side'],
      durationSeconds: 2.2,
      reason: 'Gancho no gesto',
      join: 'cut',
      motion: 'none',
      preferPeak: true,
    },
    {
      name: 'trabalho-1',
      roles: ['side'],
      durationSeconds: 5,
      reason: 'Estação e ritmo',
      join: 'cut',
      motion: 'none',
      preferPeak: true,
    },
    {
      name: 'trabalho-2',
      roles: ['side'],
      durationSeconds: 5,
      reason: 'Segundo take de ofício',
      join: 'cut',
      motion: 'none',
      preferPeak: true,
    },
    {
      name: 'prato',
      roles: ['food'],
      durationSeconds: 4.2,
      reason: 'Payoff do gesto',
      join: 'cut',
      punchIn: true,
      motion: 'punch',
      preferPeak: true,
    },
    {
      name: 'pass',
      roles: ['master'],
      durationSeconds: 4,
      reason: 'O prato sai',
      join: 'cut',
      fadeOut: true,
      motion: 'drift',
      preferPeak: true,
    },
  ]),
  assinatura: spec('assinatura', 'cut', 18, 0.55, 2, [
    {
      name: 'lugar',
      roles: ['ambience', 'master'],
      durationSeconds: 3.4,
      reason: 'Chão para o close',
      join: 'cut',
      fadeIn: true,
      motion: 'drift',
      preferPeak: true,
    },
    {
      name: 'oficio',
      roles: ['side'],
      durationSeconds: 3.2,
      reason: 'A mão que justifica o prato',
      join: 'cut',
      motion: 'none',
      preferPeak: true,
    },
    {
      name: 'hero-1',
      roles: ['food'],
      durationSeconds: 5.2,
      reason: 'Melhor pico de comida',
      join: 'cut',
      punchIn: true,
      motion: 'punch',
      preferPeak: true,
    },
    {
      name: 'hero-2',
      roles: ['food'],
      durationSeconds: 4.2,
      reason: 'Segundo close do prato',
      join: 'dissolve',
      punchIn: true,
      motion: 'punch',
      preferPeak: true,
    },
    {
      name: 'saida',
      roles: ['master', 'ambience'],
      durationSeconds: 3.2,
      reason: 'Entrega ou sala',
      join: 'dissolve',
      fadeOut: true,
      motion: 'drift',
      preferPeak: true,
    },
  ]),
  pulso: spec(
    'pulso',
    'cut',
    15,
    0.32,
    3,
    pulsoRoles.map((roles, index) => ({
      name: `pulso-${index + 1}`,
      roles,
      durationSeconds: index === pulsoRoles.length - 1 ? 2.6 : 1.9,
      reason: 'Corte seco no pico, as quatro câmeras',
      join: 'cut' as const,
      fadeOut: index === pulsoRoles.length - 1,
      motion: 'none' as const,
      preferPeak: true,
    })),
  ),
};

export function specToPlaybook(input: ProgramPresetSpec): Playbook {
  const spec = programPresetSpecSchema.parse(input);
  return {
    program: spec.program,
    join: spec.join,
    targetDuration: spec.targetDuration,
    maxShare: spec.maxShare,
    minRoles: spec.minRoles,
    beats: spec.beats,
    captions: spec.captions,
    branding: spec.branding,
  };
}

export function playbookFor(program: EditProgram, override?: Playbook | null): Playbook {
  if (override && override.program === program && override.beats.length >= 3) return override;
  return specToPlaybook(validatedProgramPresets[program]);
}

export function playbookForDuration(
  program: EditProgram,
  durationSeconds: number,
  override?: Playbook | null,
): Playbook {
  const target = Math.max(8, Math.min(90, durationSeconds));
  const base = playbookFor(program, override);
  const recipe =
    override && override.program === program && override.beats.length >= 3
      ? override.beats
      : validatedProgramPresets[program].beats;
  const filled = fillTakes(recipe, takeCountForDuration(program, target));
  return specToPlaybook({
    schemaVersion: '1.0',
    program: base.program,
    join: base.join,
    targetDuration: target,
    maxShare: base.maxShare,
    minRoles: base.minRoles,
    beats: fitBeatsToTarget(filled, target),
    captions: base.captions,
    branding: base.branding,
  });
}

export function cloneValidatedSpec(program: EditProgram): ProgramPresetSpec {
  return programPresetSpecSchema.parse(
    JSON.parse(JSON.stringify(validatedProgramPresets[program])),
  );
}
