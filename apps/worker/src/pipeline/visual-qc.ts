import type { QualityStatus } from '@reelops/shared';
import { config } from '../config.js';

export type VisualQualityReport = {
  status: QualityStatus | 'skipped';
  foodPresentationScore?: number;
  subjectFramingScore?: number;
  visualScore?: number;
  brandScore?: number;
  storyScore?: number;
  professionalismScore?: number;
  cropScore?: number;
  issues: string[];
  decision?: 'pass' | 'fail' | 'needs_review';
  reason: string;
};

export async function runVisualQc(): Promise<VisualQualityReport> {
  if (!config.ENABLE_VISUAL_QC) {
    return { status: 'skipped', issues: [], reason: 'ENABLE_VISUAL_QC=false' };
  }
  return {
    status: 'needs_review',
    issues: ['VISUAL_QC_NOT_WIRED'],
    decision: 'needs_review',
    reason: 'ARCHITECTURE READY — provider not called',
  };
}
