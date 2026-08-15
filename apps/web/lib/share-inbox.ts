type SharedClip = {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  size: number;
  bytes: Buffer;
  lastModified: number;
  expiresAt: number;
};

const TTL_MS = 10 * 60_000;
const inbox = new Map<string, SharedClip>();

function prune() {
  const now = Date.now();
  for (const [id, clip] of inbox) {
    if (clip.expiresAt <= now) inbox.delete(id);
  }
}

export function putSharedClip(input: {
  tenantId: string;
  name: string;
  type: string;
  bytes: Buffer;
  lastModified?: number;
}) {
  prune();
  const id = crypto.randomUUID();
  inbox.set(id, {
    id,
    tenantId: input.tenantId,
    name: input.name,
    type: input.type || 'video/mp4',
    size: input.bytes.length,
    bytes: input.bytes,
    lastModified: input.lastModified && input.lastModified > 0 ? input.lastModified : Date.now(),
    expiresAt: Date.now() + TTL_MS,
  });
  return id;
}

export function peekSharedClip(id: string, tenantId: string) {
  prune();
  const clip = inbox.get(id);
  if (!clip || clip.tenantId !== tenantId) return null;
  return {
    id: clip.id,
    name: clip.name,
    type: clip.type,
    size: clip.size,
    lastModified: clip.lastModified,
  };
}

export function takeSharedClip(id: string, tenantId: string) {
  prune();
  const clip = inbox.get(id);
  if (!clip || clip.tenantId !== tenantId) return null;
  inbox.delete(id);
  return clip;
}
