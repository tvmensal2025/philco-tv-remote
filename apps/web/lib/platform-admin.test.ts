import { describe, expect, it } from 'vitest';
import { isPlatformAdminEmail, parsePlatformAdminEmails } from './platform-admin-policy';

describe('platform admin allowlist', () => {
  it('parses comma and whitespace separated emails', () => {
    expect(parsePlatformAdminEmails('A@Casa.com, b@casa.com;c@casa.com')).toEqual([
      'a@casa.com',
      'b@casa.com',
      'c@casa.com',
    ]);
  });

  it('does not treat a restaurant owner email as platform admin', () => {
    expect(isPlatformAdminEmail('dono@restaurante.com', ['voce@cenapronta.com'])).toBe(false);
    expect(isPlatformAdminEmail('voce@cenapronta.com', ['voce@cenapronta.com'])).toBe(true);
  });

  it('ignores empty and non-email tokens', () => {
    expect(parsePlatformAdminEmails('  owner , not-an-email  ')).toEqual([]);
  });
});
