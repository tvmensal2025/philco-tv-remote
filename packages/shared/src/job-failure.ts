export const jobFailureClasses = [
  'TRANSIENT',
  'PERMANENT',
  'INPUT_ERROR',
  'PROVIDER_ERROR',
  'INFRA_ERROR',
  'QUALITY_FAILURE',
] as const;
export type JobFailureClass = (typeof jobFailureClasses)[number];

const TRANSIENT =
  /timeout|econnrefused|enotfound|429|rate.?limit|temporar|econnreset|socket hang up|REDIS|QUEUE_UNAVAILABLE|MEDIA_NOT_READY|5\d\d/i;
const INPUT =
  /NO_CAMERA|INVALID_OUTPUT|NO_SCENES|STALE_JOB|INVALID_JOB|FRAME_EXTRACTION_FAILED|SKIP_PROGRAM/i;
const PROVIDER =
  /GEMINI_API_BLOCKED|OPENAI_API_BLOCKED|VISION_PROVIDER_NOT_CONFIGURED|DIRECTOR_INVALID_OUTPUT/i;
const QUALITY = /QUALITY_FAILURE|TECHNICAL_QC|COMPOSITION_QC/i;
const PERMANENT = /OUR_SCHEMA_BUG|CORRUPT|MISSING_RECORDING|TENANT_ERROR/i;

export function classifyJobFailure(message: string): JobFailureClass {
  if (QUALITY.test(message)) return 'QUALITY_FAILURE';
  if (PROVIDER.test(message)) return 'PROVIDER_ERROR';
  if (PERMANENT.test(message)) return 'PERMANENT';
  if (INPUT.test(message)) return 'INPUT_ERROR';
  if (TRANSIENT.test(message)) return 'TRANSIENT';
  return 'INFRA_ERROR';
}

export function shouldRetryJob(kind: JobFailureClass) {
  return kind === 'TRANSIENT' || kind === 'INFRA_ERROR';
}
