import { z } from 'zod';

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

export const playbookBeatSchema = z.object({
  name: z.string().trim().min(1).max(40),
  roles: z.array(z.enum(cameraRoles)).min(1).max(4),
  durationSeconds: z.number().min(0.8).max(12),
  reason: z.string().trim().min(1).max(160),
  join: z.enum(joinNames),
  joinDurationSeconds: z.number().min(0.02).max(1.5).optional(),
  joinOverlay: z.enum(joinOverlayNames).optional(),
  fadeIn: z.boolean().optional(),
  fadeOut: z.boolean().optional(),
  punchIn: z.boolean().optional(),
  motion: z.enum(motionNames).optional(),
  preferPeak: z.boolean().optional(),
});
export type PlaybookBeat = z.infer<typeof playbookBeatSchema>;

export const programPresetSpecSchema = z.object({
  schemaVersion: z.literal('1.0'),
  program: z.enum(editPrograms),
  join: z.enum(['cut', 'dissolve']),
  targetDuration: z.number().min(8).max(45),
  maxShare: z.number().min(0.15).max(0.9),
  minRoles: z.number().int().min(1).max(4),
  beats: z.array(playbookBeatSchema).min(3).max(12),
  captions: z
    .object({
      strategy: z.enum(programCaptionStrategies),
    })
    .default({ strategy: 'full' }),
});
export type ProgramPresetSpec = z.infer<typeof programPresetSpecSchema>;

export type Playbook = {
  program: EditProgram;
  join: 'cut' | 'dissolve';
  targetDuration: number;
  maxShare: number;
  minRoles: number;
  beats: PlaybookBeat[];
  captions: { strategy: 'none' | 'full' };
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
    preview: 'white',
  },
  leak: {
    duration: 0.55,
    fadeIn: 0.14,
    fadeOut: 0.28,
    peak: 0.55,
    color: '0xFF7A18@0.48',
    preview: 'radial-gradient(ellipse at 14% 10%, #ffb060 0%, #ff6a12 32%, transparent 60%)',
  },
  burn: {
    duration: 0.42,
    fadeIn: 0.08,
    fadeOut: 0.22,
    peak: 0.72,
    color: '0xFFE0C0@0.7',
    preview:
      'radial-gradient(ellipse at 80% -6%, #fff6e8 0%, #ff9a4a 34%, #7a1a00 54%, transparent 70%)',
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
  none: 'Estático',
  drift: 'Drift',
  punch: 'Punch',
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
      | 'preferPeak'
    >
  >;
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
    status: 'architecture',
    hint: 'Slot para MOV/WebM com transparência no meio do join — ainda sem ficheiro na fábrica',
  },
  {
    id: 'title',
    group: 'overlay',
    label: 'Título',
    status: 'architecture',
    hint: 'Revideo Casa; ENABLE_REVIDEO=false',
  },
  {
    id: 'logo',
    group: 'overlay',
    label: 'Logo',
    status: 'architecture',
    hint: 'Revideo fixture; FFmpeg vertical não queima logo',
  },
  {
    id: 'lower-third',
    group: 'overlay',
    label: 'Lower third',
    status: 'architecture',
    hint: 'Primitivo do design system, sem burn no FFmpeg',
  },
  {
    id: 'cta',
    group: 'overlay',
    label: 'CTA',
    status: 'architecture',
    hint: 'Campo no decision; render FFmpeg não desenha',
  },
  {
    id: 'end-card',
    group: 'overlay',
    label: 'End card',
    status: 'architecture',
    hint: 'Só no caminho Revideo',
  },
];

function spec(
  program: EditProgram,
  join: 'cut' | 'dissolve',
  targetDuration: number,
  maxShare: number,
  minRoles: number,
  beats: PlaybookBeat[],
): ProgramPresetSpec {
  return programPresetSpecSchema.parse({
    schemaVersion: '1.0',
    program,
    join,
    targetDuration,
    maxShare,
    minRoles,
    beats,
    captions: { strategy: 'full' },
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
  casa: spec('casa', 'dissolve', 20, 0.45, 2, [
    {
      name: 'gancho',
      roles: ['ambience'],
      durationSeconds: 4.2,
      reason: 'O lugar, já em movimento',
      join: 'dissolve',
      fadeIn: true,
      motion: 'drift',
      preferPeak: true,
    },
    {
      name: 'servico',
      roles: ['master'],
      durationSeconds: 4,
      reason: 'Balcão e acolhida',
      join: 'dissolve',
      motion: 'drift',
      preferPeak: true,
    },
    {
      name: 'sala',
      roles: ['ambience'],
      durationSeconds: 3.6,
      reason: 'A sala de novo',
      join: 'dissolve',
      motion: 'drift',
      preferPeak: true,
    },
    {
      name: 'insert',
      roles: ['food'],
      durationSeconds: 3.2,
      reason: 'Insert do que se come aqui',
      join: 'fadeblack',
      punchIn: true,
      motion: 'punch',
      preferPeak: true,
    },
    {
      name: 'saida',
      roles: ['ambience', 'master'],
      durationSeconds: 5.4,
      reason: 'Saída no lugar',
      join: 'fadeblack',
      fadeOut: true,
      motion: 'drift',
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
  };
}

export function playbookFor(program: EditProgram, override?: Playbook | null): Playbook {
  if (override && override.program === program && override.beats.length >= 3) return override;
  return specToPlaybook(validatedProgramPresets[program]);
}

export function cloneValidatedSpec(program: EditProgram): ProgramPresetSpec {
  return programPresetSpecSchema.parse(
    JSON.parse(JSON.stringify(validatedProgramPresets[program])),
  );
}
