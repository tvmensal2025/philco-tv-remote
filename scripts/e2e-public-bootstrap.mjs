import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv() {
  const text = readFileSync(join(process.cwd(), '.env'), 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: tenants, error: tenantError } = await sb
  .from('tenants')
  .select('id,slug,name')
  .order('created_at');
if (tenantError) throw tenantError;
let tenant = tenants?.find((item) => item.slug === 'cenapronta') ?? tenants?.[0];
if (!tenant) {
  const created = await sb
    .from('tenants')
    .insert({ name: 'CENAPRONTA', slug: 'cenapronta', plan: 'starter' })
    .select('id,slug,name')
    .single();
  if (created.error) throw created.error;
  tenant = created.data;
}

let { data: restaurants, error: restaurantError } = await sb
  .from('restaurants')
  .select('id,tenant_id,name,timezone,settings')
  .eq('tenant_id', tenant.id);
if (restaurantError) throw restaurantError;
let restaurant = restaurants?.[0];
if (!restaurant) {
  const created = await sb
    .from('restaurants')
    .insert({ tenant_id: tenant.id, name: 'Restaurante E2E', timezone: 'America/Sao_Paulo' })
    .select('id,tenant_id,name,timezone,settings')
    .single();
  if (created.error) throw created.error;
  restaurant = created.data;
}

const { data: cameras, error: cameraError } = await sb
  .from('cameras')
  .select('id,restaurant_id,position,name,enabled,storage_prefix')
  .eq('restaurant_id', restaurant.id)
  .order('position');
if (cameraError) throw cameraError;

const { error: checksumError } = await sb.from('recordings').select('checksum').limit(1);
const checksumOk = !checksumError;

mkdirSync('test-assets/e2e', { recursive: true });
writeFileSync(
  'test-assets/e2e/context.json',
  JSON.stringify(
    {
      tenant,
      restaurant,
      cameras,
      checksumOk,
      checksumError: checksumError?.message ?? null,
      ingestKeyPresent: Boolean(env.INGEST_API_KEY && env.INGEST_API_KEY.length >= 24),
      geminiPresent: Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.length >= 10),
      geminiPrefix: env.GEMINI_API_KEY ? env.GEMINI_API_KEY.slice(0, 4) : null,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      tenantId: tenant.id,
      restaurantId: restaurant.id,
      cameras: (cameras ?? []).map((item) => ({
        id: item.id,
        position: item.position,
        enabled: item.enabled,
      })),
      checksumOk,
      geminiPresent: Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.length >= 10),
    },
    null,
    2,
  ),
);
