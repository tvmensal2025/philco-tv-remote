type EnvMap = Record<string, string | undefined>;

export function isProductionEnv(env: EnvMap = process.env) {
  if (env.CENAPRONTA_ENV === 'production') return true;
  if (env.NEXT_PHASE?.startsWith('phase-')) return false;
  return env.NODE_ENV === 'production';
}

function flagOn(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export function isAuthBypassRequested(env: EnvMap = process.env) {
  return flagOn(env.AUTH_BYPASS);
}

export function isEmergencyAuthBypass(env: EnvMap = process.env) {
  return flagOn(env.ALLOW_AUTH_BYPASS_IN_PRODUCTION);
}

export function isAuthBypass(env: EnvMap = process.env) {
  if (isProductionEnv(env)) return isAuthBypassRequested(env) && isEmergencyAuthBypass(env);
  return isAuthBypassRequested(env);
}

export function assertAuthPolicy(env: EnvMap = process.env) {
  if (isProductionEnv(env) && isAuthBypassRequested(env) && !isEmergencyAuthBypass(env)) {
    throw new Error(
      'AUTH_BYPASS is not allowed in production without ALLOW_AUTH_BYPASS_IN_PRODUCTION=true',
    );
  }
  if (isProductionEnv(env) && isAuthBypass(env)) {
    console.error('CRITICAL: AUTH_BYPASS enabled in production. The UI is using the service role.');
  }
}
