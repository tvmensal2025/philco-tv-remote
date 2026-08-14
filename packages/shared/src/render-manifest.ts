import {
  PIPELINE_VERSION,
  DIRECTOR_SCHEMA_VERSION,
  DESIGN_SYSTEM_VERSION,
  TEMPLATE_VERSION,
} from './video-decision.js';
import type { TechnicalQualityReport, CompositionQualityReport } from './quality.js';

export type RenderManifest = {
  renderId: string;
  pipelineVersion: string;
  directorSchemaVersion: string;
  template: string;
  templateVersion: string;
  designSystemVersion: string;
  visionProvider: string;
  visionModel?: string;
  vision_real: boolean;
  compositionRenderer: 'ffmpeg' | 'revideo';
  compositionRendererRequested: 'ffmpeg' | 'revideo';
  compositionFallbackReason?: string;
  renderProfileRequested?: string;
  renderProfileUsed?: string;
  renderFallbackReason?: string;
  sourceChecksums: string[];
  startedAt: string;
  completedAt?: string;
  ffmpegVersion?: string;
  quality?: {
    technical?: TechnicalQualityReport;
    composition?: CompositionQualityReport;
    visual?: { status?: string; reason?: string };
    status?: string;
  };
};

export function createRenderManifest(
  partial: Omit<
    RenderManifest,
    'pipelineVersion' | 'directorSchemaVersion' | 'templateVersion' | 'designSystemVersion'
  > & {
    directorSchemaVersion?: string;
  },
): RenderManifest {
  return {
    ...partial,
    pipelineVersion: PIPELINE_VERSION,
    directorSchemaVersion: partial.directorSchemaVersion ?? DIRECTOR_SCHEMA_VERSION,
    templateVersion: TEMPLATE_VERSION,
    designSystemVersion: DESIGN_SYSTEM_VERSION,
  };
}
