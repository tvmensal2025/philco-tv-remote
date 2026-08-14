import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const context = JSON.parse(readFileSync('test-assets/e2e/context.json', 'utf8'));
const reelSource = ['test-assets/e2e/v2-casa.json', 'test-assets/e2e/core-stabilize.json']
  .map((file) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  })
  .find((json) => json?.reelIds?.[0]);
const reelId = reelSource?.reelIds?.[0];
if (!reelId) throw new Error('Nenhum reel de fixture para isolamento');
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const slug = `iso-${Date.now()}`;
const { data: tenantB, error } = await sb
  .from('tenants')
  .insert({ name: 'Tenant B isolation', slug, plan: 'starter' })
  .select('id')
  .single();
if (error || !tenantB) throw new Error(error?.message ?? 'tenant B insert failed');
const sameCookie = await fetch(`http://127.0.0.1:3000/api/media/${reelId}`, {
  headers: { cookie: `reelops-tenant=${context.tenant.id}` },
});
const crossCookie = await fetch(`http://127.0.0.1:3000/api/media/${reelId}`, {
  headers: { cookie: `reelops-tenant=${tenantB.id}` },
});
const crossBody = await crossCookie.text();
const leak =
  /ftyp|moov|mdat|video\/mp4/i.test(crossBody) ||
  crossCookie.headers.get('content-type')?.includes('video');
const report = {
  reelId,
  tenantA: context.tenant.id,
  tenantB: tenantB.id,
  sameTenantStatus: sameCookie.status,
  crossTenantStatus: crossCookie.status,
  crossContentType: crossCookie.headers.get('content-type'),
  leakedBytes: leak,
  pass: [403, 404].includes(crossCookie.status) && !leak,
};
writeFileSync('work/revideo-evidence/tenant-isolation.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await sb.from('tenants').delete().eq('id', tenantB.id);
if (!report.pass) process.exit(2);
