import { defaultSafeArea } from '@reelops/shared';

export const designPrimitives = [
  'VideoFrame',
  'ImageFrame',
  'Title',
  'Subtitle',
  'Logo',
  'CTA',
  'Gradient',
  'Overlay',
  'LowerThird',
  'SafeArea',
  'Transition',
  'BrandFrame',
  'EndCard',
] as const;

export type DesignPrimitive = (typeof designPrimitives)[number];

export const programTemplates = {
  casa: ['SafeArea', 'VideoFrame', 'Title', 'Logo', 'Gradient', 'EndCard'],
  oficio: ['SafeArea', 'VideoFrame', 'LowerThird', 'EndCard'],
  assinatura: ['SafeArea', 'VideoFrame', 'Title', 'Logo', 'EndCard'],
  pulso: ['SafeArea', 'VideoFrame', 'Overlay', 'CTA', 'EndCard'],
} as const;

export const casaCompositionLayout = {
  frame: { width: 1080, height: 1920 },
  safeArea: defaultSafeArea,
  titleBox: { x: 90, y: 360, w: 900, h: 88 },
  logoBox: { x: 90, y: 250, w: 72, h: 72 },
  ctaBox: { x: 90, y: 1480, w: 900, h: 72 },
  fixtureBranding: true as const,
  fonts: ['CenaSerif', 'Segoe UI', 'sans-serif'],
};
