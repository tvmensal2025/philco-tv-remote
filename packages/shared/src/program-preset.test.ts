import { describe, expect, it } from 'vitest';
import {
  cloneValidatedSpec,
  playbookFor,
  programPresetSpecSchema,
  renderEffectCatalog,
  specToPlaybook,
  validatedProgramPresets,
} from './program-preset.js';

describe('validated four-program standard', () => {
  it('parses Casa, Oficio, Assinatura and Pulso', () => {
    for (const program of ['casa', 'oficio', 'assinatura', 'pulso'] as const) {
      const parsed = programPresetSpecSchema.safeParse(validatedProgramPresets[program]);
      expect(parsed.success).toBe(true);
    }
  });

  it('keeps Pulso as eight hard cuts across four roles', () => {
    const pulso = specToPlaybook(validatedProgramPresets.pulso);
    expect(pulso.beats).toHaveLength(8);
    expect(pulso.join).toBe('cut');
    expect(pulso.beats.every((beat) => beat.join === 'cut')).toBe(true);
    expect(new Set(pulso.beats.flatMap((beat) => beat.roles)).size).toBe(4);
    expect(pulso.beats.at(-1)?.durationSeconds).toBe(2.6);
  });

  it('opens Casa on ambience with dissolve, not food', () => {
    const casa = playbookFor('casa');
    expect(casa.beats[0]?.roles).toEqual(['ambience']);
    expect(casa.join).toBe('dissolve');
    expect(casa.beats.some((beat) => beat.roles.includes('food') && beat.punchIn)).toBe(true);
  });

  it('rejects invented transitions and empty timelines', () => {
    expect(
      programPresetSpecSchema.safeParse({
        ...validatedProgramPresets.pulso,
        beats: validatedProgramPresets.pulso.beats.map((beat) => ({ ...beat, join: 'wipe' })),
      }).success,
    ).toBe(false);
    expect(
      programPresetSpecSchema.safeParse({
        ...validatedProgramPresets.casa,
        beats: validatedProgramPresets.casa.beats.slice(0, 2),
      }).success,
    ).toBe(false);
  });

  it('lets a published override replace the validated book', () => {
    const override = specToPlaybook({
      ...cloneValidatedSpec('pulso'),
      beats: cloneValidatedSpec('pulso').beats.map((beat) => ({
        ...beat,
        durationSeconds: 1.2,
        joinDurationSeconds: 0.04,
      })),
    });
    expect(playbookFor('pulso', override).beats[0]?.durationSeconds).toBe(1.2);
    expect(playbookFor('pulso').beats[0]?.durationSeconds).toBe(1.9);
  });

  it('only offers real FFmpeg effects as selectable', () => {
    const real = renderEffectCatalog.filter((item) => item.status === 'real');
    const fake = renderEffectCatalog.filter((item) => item.status === 'architecture');
    expect(real.some((item) => item.id === 'cut')).toBe(true);
    expect(real.some((item) => item.id === 'overlay-flash')).toBe(true);
    expect(fake.some((item) => item.id === 'masked_reveal')).toBe(true);
    expect(fake.some((item) => item.id === 'overlay-alpha-pack')).toBe(true);
    expect(real.some((item) => item.id === 'masked_reveal')).toBe(false);
  });

  it('accepts a transparent overlay sitting on a join', () => {
    const parsed = programPresetSpecSchema.safeParse({
      ...validatedProgramPresets.pulso,
      beats: validatedProgramPresets.pulso.beats.map((beat, index) =>
        index === 1 ? { ...beat, joinOverlay: 'flash' } : beat,
      ),
    });
    expect(parsed.success).toBe(true);
  });
});
