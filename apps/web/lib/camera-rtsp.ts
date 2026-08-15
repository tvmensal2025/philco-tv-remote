import { buildRtspUrl, ingestModeOf, isMaskedRtspSecret, parseRtspUrl } from '@reelops/shared';
import { adminClient } from '@/lib/supabase';

export async function loadCameraPassword(cameraId: string) {
  const admin = adminClient();
  const { data } = await admin
    .from('camera_ingest_secrets')
    .select('rtsp_password')
    .eq('camera_id', cameraId)
    .maybeSingle();
  return typeof data?.rtsp_password === 'string' ? data.rtsp_password : '';
}

export async function saveCameraPassword(cameraId: string, tenantId: string, password: string) {
  if (!password || isMaskedRtspSecret(password)) return;
  const admin = adminClient();
  await admin.from('camera_ingest_secrets').upsert({
    camera_id: cameraId,
    tenant_id: tenantId,
    rtsp_password: password,
    updated_at: new Date().toISOString(),
  });
}

export function cameraRtspUrl(input: {
  config: Record<string, unknown>;
  password?: string;
  position?: number;
}) {
  const parsed = parseRtspUrl(typeof input.config.rtspUrl === 'string' ? input.config.rtspUrl : '');
  const host = String(input.config.rtspHost || parsed?.host || '').trim();
  if (!host) return '';
  const password =
    input.password ||
    parsed?.password ||
    (typeof input.config.rtspPassword === 'string' ? input.config.rtspPassword : '');
  return buildRtspUrl({
    host,
    username: String(input.config.rtspUsername || parsed?.username || 'admin'),
    password,
    port: String(input.config.rtspPort || parsed?.port || '554'),
    brand: String(input.config.rtspBrand || 'intelbras'),
    channel: Number(input.config.rtspChannel || input.position || 1),
    path: typeof input.config.rtspPath === 'string' ? input.config.rtspPath : undefined,
  });
}

export function publicConfigWithoutSecrets(config: Record<string, unknown>) {
  const next = { ...config };
  delete next.rtspUrl;
  delete next.rtspPassword;
  if (next.rtspStatus && typeof next.rtspStatus === 'object') {
    const status = next.rtspStatus as { message?: string };
    if (typeof status.message === 'string') {
      next.rtspStatus = {
        ...status,
        message: status.message.replace(/rtsps?:\/\/[^\s'"]+/gi, 'rtsp://***'),
      };
    }
  }
  return next;
}

export { ingestModeOf };
