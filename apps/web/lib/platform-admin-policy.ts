export type PlatformAdminRole = 'owner' | 'support' | 'readonly';

export function parsePlatformAdminEmails(raw: string | undefined) {
  return (raw ?? '')
    .split(/[,;\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.includes('@'));
}

export function isPlatformAdminEmail(email: string | undefined, allowlist: string[]) {
  if (!email) return false;
  return allowlist.includes(email.trim().toLowerCase());
}
