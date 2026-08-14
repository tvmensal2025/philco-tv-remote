import { z } from 'zod';

export const brandPersonalities = [
  'luxury_italian',
  'urban_burger',
  'japanese_minimal',
  'natural',
] as const;

export const restaurantVideoBrandSchema = z.object({
  personality: z.enum(brandPersonalities).default('natural'),
  preferredPace: z.enum(['slow', 'medium', 'medium_fast', 'fast']).optional(),
  preferredDurationMs: z.number().int().min(4000).max(60000).optional(),
  showLogo: z.boolean().default(false),
  logoObjectKey: z.string().max(500).optional(),
  cta: z.string().max(40).optional(),
  voiceId: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length >= 8 ? value.trim() : undefined),
    z.string().min(8).max(80).optional(),
  ),
  textDensity: z.enum(['low', 'medium', 'high']).default('low'),
  motionStyle: z.enum(['none', 'subtle', 'dynamic']).default('subtle'),
});

export type RestaurantVideoBrandProfile = z.infer<typeof restaurantVideoBrandSchema>;

export function brandFromRestaurantSettings(
  settings: Record<string, unknown> | null | undefined,
): RestaurantVideoBrandProfile {
  const raw = settings?.videoBrand ?? settings?.video_brand ?? {};
  const parsed = restaurantVideoBrandSchema.safeParse(raw);
  return parsed.success ? parsed.data : restaurantVideoBrandSchema.parse({});
}
