import { config } from '../config.js';

export type WameSendKind = 'text' | 'video' | 'image' | 'document';

export type WameSendInput = {
  dest: string;
  kind: WameSendKind;
  text?: string;
  url?: string;
  caption?: string;
};

type WameOutcome = { ok: true; messageId: string | null } | { ok: false; detail: string };

function wameBase() {
  const server = (config.WAME_SERVER || 'https://us.api-wa.me').replace(/\/$/, '');
  const key = config.WAME_API_KEY?.trim();
  if (!key) throw new Error('WAME_NOT_CONFIGURED');
  return `${server}/${key}`;
}

function recipient(dest: string) {
  return dest.replace(/\D/g, '');
}

async function post(
  route: string,
  body: Record<string, unknown>,
  timeoutMs = 45_000,
): Promise<WameOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${wameBase()}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, provider: 'whatsapp' }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok)
      return { ok: false, detail: `HTTP ${response.status}: ${text.slice(0, 240)}` };
    let messageId: string | null = null;
    try {
      const data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      const nested =
        data?.message && typeof data.message === 'object'
          ? (data.message as Record<string, unknown>)
          : null;
      const key =
        data?.key && typeof data.key === 'object' ? (data.key as Record<string, unknown>) : null;
      messageId = String(data?.messageId ?? nested?.id ?? data?.id ?? key?.id ?? '') || null;
    } catch {
      messageId = null;
    }
    return { ok: true, messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: /abort/i.test(message) ? 'timeout' : message };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendWhatsApp(input: WameSendInput) {
  const to = recipient(input.dest);
  if (!to) throw new Error('WAME_DEST_INVALID');
  let result: WameOutcome;
  if (input.kind === 'text') {
    result = await post('message/text', { to, text: input.text ?? '' }, 12_000);
  } else if (input.kind === 'video') {
    if (!input.url) throw new Error('WAME_VIDEO_URL_REQUIRED');
    result = await post('message/video', { to, url: input.url, caption: input.caption ?? '' });
  } else if (input.kind === 'image') {
    if (!input.url) throw new Error('WAME_IMAGE_URL_REQUIRED');
    result = await post('message/image', { to, url: input.url, caption: input.caption ?? '' });
  } else {
    if (!input.url) throw new Error('WAME_DOCUMENT_URL_REQUIRED');
    result = await post('message/document', {
      to,
      url: input.url,
      caption: input.caption ?? '',
      mimetype: 'video/mp4',
      fileName: 'reel.mp4',
    });
  }
  if (!result.ok) throw new Error(`WAME_${input.kind.toUpperCase()}:${result.detail}`);
  return result;
}

export async function probeWame() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${wameBase()}/instance`, { signal: controller.signal });
    if (!response.ok) return { connected: false };
    const info = (await response.json()) as Record<string, unknown>;
    const inst = (
      info.instance && typeof info.instance === 'object' ? info.instance : info
    ) as Record<string, unknown>;
    return { connected: inst.phoneConnected === true || inst.connected === true };
  } catch {
    return { connected: false };
  } finally {
    clearTimeout(timer);
  }
}
