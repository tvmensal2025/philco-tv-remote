export const cameraIngestModes = ['folder', 'rtsp', 'phone'] as const;
export type CameraIngestMode = (typeof cameraIngestModes)[number];

export const cameraSourceTypes = ['minio', 'rtsp', 'nvr'] as const;
export type CameraSourceType = (typeof cameraSourceTypes)[number];

export const rtspBrands = ['intelbras', 'hikvision', 'dahua', 'xm', 'generic'] as const;
export type RtspBrand = (typeof rtspBrands)[number];

export type ParsedRtsp = {
  protocol: 'rtsp' | 'rtsps';
  username: string;
  password: string;
  host: string;
  port: string;
  path: string;
};

const MASK = '****';

export function isRtspUrl(value: string) {
  return /^rtsps?:\/\//i.test(value.trim());
}

export function isMaskedRtspSecret(value: string | null | undefined) {
  const secret = String(value ?? '');
  return secret.length > 0 && /^\*+$/.test(secret);
}

export function redactRtsp(text: string) {
  return String(text ?? '').replace(/rtsps?:\/\/[^\s'"]+/gi, 'rtsp://***');
}

function decodePart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseRtspUrl(value: string | null | undefined): ParsedRtsp | null {
  const trimmed = String(value ?? '').trim();
  const proto = trimmed.match(/^(rtsps?):\/\//i);
  if (!proto) return null;
  const protocol = proto[1].toLowerCase() === 'rtsps' ? 'rtsps' : 'rtsp';
  const rest = trimmed.slice(proto[0].length);
  const cut = rest.search(/[/?]/);
  const authority = cut === -1 ? rest : rest.slice(0, cut);
  const path = cut === -1 ? '/' : rest.slice(cut);
  if (!authority) return null;
  const at = authority.lastIndexOf('@');
  let userinfo = '';
  let hostport = authority;
  if (at !== -1) {
    userinfo = authority.slice(0, at);
    hostport = authority.slice(at + 1);
  }
  let username = '';
  let password = '';
  if (userinfo) {
    const colon = userinfo.indexOf(':');
    if (colon === -1) username = decodePart(userinfo);
    else {
      username = decodePart(userinfo.slice(0, colon));
      password = decodePart(userinfo.slice(colon + 1));
    }
  }
  let host = hostport;
  let port = '';
  if (hostport.startsWith('[')) {
    const close = hostport.indexOf(']');
    if (close === -1) return null;
    host = hostport.slice(1, close);
    if (hostport[close + 1] === ':') port = hostport.slice(close + 2);
  } else {
    const colon = hostport.lastIndexOf(':');
    if (colon !== -1 && /^\d+$/.test(hostport.slice(colon + 1))) {
      host = hostport.slice(0, colon);
      port = hostport.slice(colon + 1);
    }
  }
  if (!host) return null;
  return { protocol, username, password, host, port, path: path || '/' };
}

export function formatRtspUrl(parsed: ParsedRtsp, options?: { mask?: boolean }) {
  const password = options?.mask ? MASK : parsed.password;
  const userinfo = parsed.username
    ? `${encodeURIComponent(parsed.username)}:${encodeURIComponent(password)}@`
    : '';
  const port = parsed.port ? `:${parsed.port}` : '';
  const path = parsed.path.startsWith('/') ? parsed.path : `/${parsed.path}`;
  return `${parsed.protocol}://${userinfo}${parsed.host}${port}${path}`;
}

export function maskRtspUrl(value: string | null | undefined) {
  const parsed = parseRtspUrl(value);
  if (!parsed) return '';
  return formatRtspUrl(parsed, { mask: true });
}

export function mergeRtspUrl(next: string | null | undefined, previous: string | null | undefined) {
  const incoming = String(next ?? '').trim();
  const current = String(previous ?? '').trim();
  if (!incoming) return current;
  const parsedNext = parseRtspUrl(incoming);
  if (!parsedNext) return incoming;
  if (!isMaskedRtspSecret(parsedNext.password)) return formatRtspUrl(parsedNext);
  const parsedPrev = parseRtspUrl(current);
  parsedNext.password = parsedPrev?.password ?? '';
  return formatRtspUrl(parsedNext);
}

export function intelbrasRtspPath(channel: number, subtype = 0) {
  const ch = Math.max(1, Math.min(16, Math.round(channel)));
  return `/cam/realmonitor?channel=${ch}&subtype=${subtype}`;
}

export function hikvisionRtspPath(channel: number) {
  const ch = Math.max(1, Math.min(16, Math.round(channel)));
  return `/Streaming/Channels/${ch}01`;
}

export function rtspPathForBrand(brand: string, channel: number) {
  if (brand === 'hikvision') return hikvisionRtspPath(channel);
  if (brand === 'xm') return `/user=admin&password=&channel=${channel}&stream=0.sdp?`;
  return intelbrasRtspPath(channel);
}

export function buildRtspUrl(input: {
  host: string;
  username?: string;
  password?: string;
  port?: string | number;
  brand?: string;
  channel?: number;
  path?: string;
}) {
  const channel = input.channel ?? 1;
  const path = input.path || rtspPathForBrand(input.brand ?? 'intelbras', channel);
  return formatRtspUrl({
    protocol: 'rtsp',
    username: input.username ?? 'admin',
    password: input.password ?? '',
    host: input.host.trim(),
    port: String(input.port ?? '554'),
    path,
  });
}

export function ingestModeOf(
  sourceType: string | null | undefined,
  config: Record<string, unknown> | null | undefined,
): CameraIngestMode {
  const mode = config?.ingestMode;
  if (mode === 'rtsp' || sourceType === 'rtsp') return 'rtsp';
  if (mode === 'phone') return 'phone';
  return 'folder';
}

export function sourceTypeForMode(
  mode: CameraIngestMode,
  previous?: string | null,
): CameraSourceType {
  if (mode === 'rtsp') return 'rtsp';
  if (mode === 'phone') return 'minio';
  if (previous === 'nvr' || previous === 'minio') return previous;
  return 'minio';
}

export function publicCameraSource(
  sourceType: string | null | undefined,
  config: Record<string, unknown> | null | undefined,
): {
  sourceType: CameraSourceType;
  ingestMode: CameraIngestMode;
  rtspHost: string;
  rtspPort: string;
  rtspUsername: string;
  rtspBrand: string;
  rtspChannel: number;
  rtspHasPassword: boolean;
  rtspTransport: 'tcp' | 'udp';
  rtspStatus: { state?: string; message?: string; at?: string } | null;
  folderPath: string;
} {
  const safe = { ...(config && typeof config === 'object' ? config : {}) };
  const parsed = parseRtspUrl(typeof safe.rtspUrl === 'string' ? safe.rtspUrl : '');
  const ingestMode = ingestModeOf(sourceType, safe);
  const status =
    safe.rtspStatus && typeof safe.rtspStatus === 'object'
      ? (safe.rtspStatus as { state?: string; message?: string; at?: string })
      : null;
  return {
    sourceType: ingestMode === 'rtsp' ? 'rtsp' : sourceType === 'nvr' ? 'nvr' : 'minio',
    ingestMode,
    rtspHost: typeof safe.rtspHost === 'string' ? safe.rtspHost : (parsed?.host ?? ''),
    rtspPort: typeof safe.rtspPort === 'string' ? safe.rtspPort : parsed?.port || '554',
    rtspUsername:
      typeof safe.rtspUsername === 'string' ? safe.rtspUsername : parsed?.username || 'admin',
    rtspBrand: typeof safe.rtspBrand === 'string' ? safe.rtspBrand : 'intelbras',
    rtspChannel: Number(safe.rtspChannel ?? parsed?.path.match(/channel=(\d+)/)?.[1] ?? 1) || 1,
    rtspHasPassword: Boolean(safe.rtspHasPassword) || Boolean(parsed?.password),
    rtspTransport: safe.rtspTransport === 'udp' ? 'udp' : 'tcp',
    rtspStatus: status,
    folderPath: typeof safe.folderPath === 'string' ? safe.folderPath : '',
  };
}
