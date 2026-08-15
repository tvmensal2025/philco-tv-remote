import { notFound } from 'next/navigation';
import VideoEditor, { createEmptyProject } from '@/components/video-editor/video-editor';
import { projectFromDecision } from '@reelops/shared';
import type { VideoEditDecisionV2 } from '@reelops/shared';

export const dynamic = 'force-dynamic';

function fixtureDecision(): VideoEditDecisionV2 {
  return {
    schemaVersion: '2.0',
    tenantId: '11111111-1111-4111-8111-111111111111',
    restaurantId: '22222222-2222-4222-8222-222222222222',
    momentId: '33333333-3333-4333-8333-333333333333',
    reelId: '44444444-4444-4444-8444-444444444444',
    program: 'pulso',
    scoreScale: '0-100',
    durationTargetMs: 12_000,
    editingIntensity: 0.8,
    story: { type: 'energy', pace: 'fast', emotion: 'pulse', hookStrength: 88 },
    scenes: [
      {
        sceneId: '00000000-0000-4000-8000-000000000001',
        recordingId: 'rec-1',
        cameraId: 'cam-1',
        cameraPosition: 1,
        cameraRole: 'master',
        sourceStartMs: 0,
        sourceEndMs: 3200,
        sceneRole: 'hook',
        shotStyle: 'slow_push',
        reframeStrategy: 'static',
        primarySubjectRole: null,
        transitionOut: 'hard_cut',
        importance: 91,
        cutSafetyScore: 80,
        zoomEvents: [],
        reason: 'Maior clareza visual + movimento',
      },
      {
        sceneId: '00000000-0000-4000-8000-000000000002',
        recordingId: 'rec-3',
        cameraId: 'cam-3',
        cameraPosition: 3,
        cameraRole: 'food',
        sourceStartMs: 5400,
        sourceEndMs: 8900,
        sceneRole: 'hero',
        shotStyle: 'punch_in',
        reframeStrategy: 'static',
        primarySubjectRole: 'food',
        transitionOut: 'soft_dissolve',
        importance: 94,
        cutSafetyScore: 77,
        zoomEvents: [],
        reason: 'Prato nítido no pico de ação',
      },
    ],
    audioStrategy: 'ambient_plus_music',
    brandingProfileId: null,
    captionStrategy: 'full',
    qualityRequirements: { minimumVisualScore: 0, minimumBrandScore: 0 },
    text: { enabled: true, title: 'No balcão', subtitle: null, cta: null },
    audio: {
      strategy: 'ambient_plus_music',
      preserveAmbient: true,
      originalGainDb: 0,
      musicGainDb: -8,
      voiceGainDb: null,
    },
  };
}

export default function E2EEditorPage() {
  if (process.env.E2E_TEST_MODE !== '1') notFound();
  const project = projectFromDecision({
    decision: fixtureDecision(),
    takes: [
      {
        recordingId: 'rec-1',
        cameraId: 'cam-1',
        cameraPosition: 1,
        cameraLabel: 'C1 Serviço',
        durationMs: 20_000,
      },
      {
        recordingId: 'rec-3',
        cameraId: 'cam-3',
        cameraPosition: 3,
        cameraLabel: 'C3 Prato',
        durationMs: 20_000,
      },
      {
        recordingId: 'rec-4',
        cameraId: 'cam-4',
        cameraPosition: 4,
        cameraLabel: 'C4 Sala',
        durationMs: 20_000,
      },
    ],
    rejected: [{ cameraPosition: 4, reason: 'Baixa coerência visual' }],
    name: 'Fixture Pulso',
  });
  return <VideoEditor initial={project ?? createEmptyProject()} title="Editor fixture" />;
}
