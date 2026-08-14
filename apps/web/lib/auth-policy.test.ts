import { describe, expect, it } from 'vitest';
import { assertAuthPolicy, isAuthBypass } from './auth-policy';

describe('AUTH_BYPASS policy', () => {
  it('stays off in development unless AUTH_BYPASS is explicit', () => {
    expect(isAuthBypass({ NODE_ENV: 'development' })).toBe(false);
    expect(isAuthBypass({ NODE_ENV: 'development', AUTH_BYPASS: 'true' })).toBe(true);
  });

  it('stays off in production when AUTH_BYPASS is absent', () => {
    expect(isAuthBypass({ NODE_ENV: 'production' })).toBe(false);
    expect(() => assertAuthPolicy({ NODE_ENV: 'production' })).not.toThrow();
  });

  it('stays off in production even if AUTH_BYPASS=true', () => {
    expect(isAuthBypass({ NODE_ENV: 'production', AUTH_BYPASS: 'true' })).toBe(false);
    expect(() => assertAuthPolicy({ NODE_ENV: 'production', AUTH_BYPASS: 'true' })).toThrow(
      /AUTH_BYPASS is not allowed in production/,
    );
  });

  it('does not treat next build as production', () => {
    expect(
      isAuthBypass({
        NODE_ENV: 'production',
        NEXT_PHASE: 'phase-production-build',
        AUTH_BYPASS: 'true',
      }),
    ).toBe(true);
  });

  it('allows production bypass only with the emergency flag', () => {
    const env = {
      NODE_ENV: 'production',
      AUTH_BYPASS: 'true',
      ALLOW_AUTH_BYPASS_IN_PRODUCTION: 'true',
    };
    expect(isAuthBypass(env)).toBe(true);
    expect(() => assertAuthPolicy(env)).not.toThrow();
  });
});
