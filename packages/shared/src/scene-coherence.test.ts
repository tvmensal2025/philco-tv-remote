import { describe, expect, it } from 'vitest';
import {
  detectBrandMismatch,
  evaluateSceneCoherence,
  groundedCaption,
  scoreCameraCandidate,
  type CameraSceneSignal,
} from './scene-coherence.js';

function camera(
  partial: Partial<CameraSceneSignal> & Pick<CameraSceneSignal, 'cameraId' | 'cameraPosition'>,
): CameraSceneSignal {
  return {
    cameraRole: 'master',
    summary: '',
    lighting: 0.7,
    foodVisibility: 0.6,
    personVisibility: 0.6,
    actionRelevance: 0.7,
    cropFeasibility: 0.8,
    ...partial,
  };
}

describe('scene coherence gate', () => {
  it('rejects mixed Wikimedia kitchens and keeps the strongest camera', () => {
    const result = evaluateSceneCoherence([
      camera({
        cameraId: 'c1',
        cameraPosition: 1,
        cameraRole: 'master',
        summary: 'tandoor bakery, stacked bread, three bakers, indoor kitchen',
        lighting: 0.72,
        foodVisibility: 0.8,
        personVisibility: 0.85,
        actionRelevance: 0.8,
        visionScore: 78,
      }),
      camera({
        cameraId: 'c2',
        cameraPosition: 2,
        cameraRole: 'side',
        summary: 'dark rustic kitchen, person holding a bag, face in shadow',
        lighting: 0.12,
        foodVisibility: 0.1,
        personVisibility: 0.4,
        actionRelevance: 0.2,
        cropFeasibility: 0.3,
      }),
      camera({
        cameraId: 'c3',
        cameraPosition: 3,
        cameraRole: 'food',
        summary: 'wok stir-fry, ground meat, steam, different kitchen',
        lighting: 0.55,
        foodVisibility: 0.7,
        personVisibility: 0.1,
        actionRelevance: 0.6,
        visionScore: 62,
      }),
      camera({
        cameraId: 'c4',
        cameraPosition: 4,
        cameraRole: 'ambience',
        summary: 'chef talking outside Caravela, CANAL MADEIRA watermark, Super Bock umbrellas',
        lighting: 0.5,
        foodVisibility: 0.05,
        personVisibility: 0.7,
        actionRelevance: 0.2,
        watermark: true,
        externalBrand: true,
        visionScore: 20,
      }),
    ]);
    expect(result.primaryCameraId).toBe('c1');
    expect(result.recommendedMode).toBe('single_camera');
    expect(result.compatibleCameraIds).toEqual(['c1']);
    expect(result.rejected.map((row) => row.cameraId).sort()).toEqual(['c2', 'c3', 'c4']);
    expect(result.rejected.find((row) => row.cameraId === 'c4')?.reason).toMatch(/brand/i);
    expect(detectBrandMismatch('CANAL MADEIRA / Caravela')).toBe(true);
  });

  it('allows dual camera when two views share the same kitchen story', () => {
    const result = evaluateSceneCoherence([
      camera({
        cameraId: 'master',
        cameraPosition: 1,
        summary: 'indoor kitchen, chef plating bread from the oven',
        lighting: 0.7,
        foodVisibility: 0.7,
        personVisibility: 0.7,
      }),
      camera({
        cameraId: 'food',
        cameraPosition: 3,
        cameraRole: 'food',
        summary: 'indoor kitchen close-up of bread coming out of the oven',
        lighting: 0.68,
        foodVisibility: 0.9,
        personVisibility: 0.2,
        actionRelevance: 0.75,
      }),
    ]);
    expect(result.recommendedMode).toBe('dual_camera');
    expect(result.compatibleCameraIds).toContain('master');
    expect(result.compatibleCameraIds).toContain('food');
  });
});

describe('camera candidate score', () => {
  it('does not let ambience role beat a stronger master', () => {
    const master = scoreCameraCandidate(
      camera({
        cameraId: 'c1',
        cameraPosition: 1,
        cameraRole: 'master',
        lighting: 0.74,
        foodVisibility: 0.7,
        personVisibility: 0.8,
      }),
      100,
    );
    const ambience = scoreCameraCandidate(
      camera({
        cameraId: 'c4',
        cameraPosition: 4,
        cameraRole: 'ambience',
        lighting: 0.45,
        foodVisibility: 0.1,
        personVisibility: 0.5,
        watermark: true,
      }),
      8,
    );
    expect(master.score).toBeGreaterThan(ambience.score);
    expect(ambience.score).toBeLessThan(40);
  });
});

describe('copy safety', () => {
  it('drops captions that invent cuisine or do not match the scene', () => {
    expect(
      groundedCaption({
        caption: 'Sabor brasileiro no coração da casa',
        visionReason: 'tandoor bread bakers',
      }),
    ).toBeNull();
    expect(
      groundedCaption({
        caption: 'Pão saindo do forno',
        visionReason: 'pão saindo do forno tandoor',
      }),
    ).toMatch(/pão/i);
  });
});
