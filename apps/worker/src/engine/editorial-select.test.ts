import { describe, expect, it } from 'vitest';
import { selectEditorialCameras } from './editorial-select.js';

describe('editorial select', () => {
  it('chooses single-camera C1 from mixed stock without hardcoding the winner label', () => {
    const editorial = selectEditorialCameras([
      {
        cameraId: 'cam-master',
        cameraPosition: 1,
        cameraRole: 'master',
        summary: 'indoor tandoor bakery, stacked bread, bakers working',
        lighting: 0.74,
        foodVisibility: 0.8,
        personVisibility: 0.8,
        actionRelevance: 0.8,
        cropFeasibility: 0.9,
        visionScore: 80,
      },
      {
        cameraId: 'cam-side',
        cameraPosition: 2,
        cameraRole: 'side',
        summary: 'dark kitchen, face in shadow',
        lighting: 0.11,
        foodVisibility: 0.1,
        personVisibility: 0.3,
        actionRelevance: 0.2,
        cropFeasibility: 0.2,
      },
      {
        cameraId: 'cam-food',
        cameraPosition: 3,
        cameraRole: 'food',
        summary: 'wok stir-fry in another kitchen',
        lighting: 0.5,
        foodVisibility: 0.7,
        personVisibility: 0.1,
        actionRelevance: 0.5,
        cropFeasibility: 0.7,
        visionScore: 60,
      },
      {
        cameraId: 'cam-ambience',
        cameraPosition: 4,
        cameraRole: 'ambience',
        summary: 'CANAL MADEIRA chef talking outside Caravela',
        lighting: 0.48,
        foodVisibility: 0.05,
        personVisibility: 0.6,
        actionRelevance: 0.2,
        cropFeasibility: 0.4,
        watermark: true,
        externalBrand: true,
      },
    ]);
    expect(editorial.primaryCameraId).toBe('cam-master');
    expect(editorial.recommendedMode).toBe('single_camera');
    expect(editorial.compatibleCameraIds).toEqual(['cam-master']);
  });
});
