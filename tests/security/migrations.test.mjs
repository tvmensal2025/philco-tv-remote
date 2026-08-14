import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDirectory = path.join(root, 'supabase', 'migrations');
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
const migrations = await Promise.all(
  migrationNames.map(async (name) => ({
    name,
    sql: await readFile(path.join(migrationsDirectory, name), 'utf8'),
  })),
);
const allSql = migrations.map(({ sql }) => sql).join('\n');
const hardening = migrations.find(({ name }) => name === '0004_security_hardening.sql')?.sql ?? '';

function finalPolicyState() {
  const policies = new Map();
  const operation =
    /(create\s+policy\s+[a-z0-9_]+\s+on\s+(?:public\.)?[a-z0-9_]+[^;]*;|drop\s+policy\s+(?:if\s+exists\s+)?[a-z0-9_]+\s+on\s+(?:public\.)?[a-z0-9_]+\s*;)/gi;

  for (const { sql } of migrations) {
    for (const match of sql.matchAll(operation)) {
      const statement = match[0];
      const created = statement.match(
        /^create\s+policy\s+([a-z0-9_]+)\s+on\s+(?:public\.)?([a-z0-9_]+)/i,
      );
      if (created) {
        const command =
          statement.match(/\bfor\s+(select|insert|update|delete|all)\b/i)?.[1].toUpperCase() ??
          'ALL';
        policies.set(`${created[2]}.${created[1]}`, {
          table: created[2],
          name: created[1],
          command,
        });
        continue;
      }
      const dropped = statement.match(
        /^drop\s+policy\s+(?:if\s+exists\s+)?([a-z0-9_]+)\s+on\s+(?:public\.)?([a-z0-9_]+)/i,
      );
      if (dropped) policies.delete(`${dropped[2]}.${dropped[1]}`);
    }
  }
  return [...policies.values()];
}

test('migrations are ordered and the hardening migration is present', () => {
  assert.deepEqual(migrationNames, [
    '0001_initial.sql',
    '0002_bootstrap.sql',
    '0003_product_readiness.sql',
    '0004_security_hardening.sql',
    '0005_functional_mvp.sql',
    '0006_capabilities.sql',
    '0007_grants_and_readonly.sql',
    '0008_highlight_engine.sql',
    '0009_cenapronta_layout.sql',
    '0010_cenapronta_p0.sql',
    '0011_openai_vision_provider.sql',
    '0012_camera_roles.sql',
    '0013_recording_timestamp_idempotency.sql',
    '0014_moment_client_request_id.sql',
    '0015_platform_admin.sql',
  ]);
});

test('the final RLS policy state is read-only', () => {
  const policies = finalPolicyState();
  assert.ok(policies.length > 0, 'expected SELECT policies to remain');
  assert.deepEqual([...new Set(policies.map(({ command }) => command))], ['SELECT']);
  assert.equal(
    policies.some(({ table, name }) => table === 'reels' && name === 'reel_write'),
    false,
  );
  assert.match(hardening, /cmd\s*<>\s*'SELECT'/i, 'drifted write policies must also be removed');
  assert.doesNotMatch(hardening, /create\s+policy\s+reel_write/i);
});

test('client table privileges cannot bypass the API mutation layer', () => {
  const readableTables = [
    'tenants',
    'tenant_members',
    'restaurants',
    'cameras',
    'moments',
    'reels',
    'job_events',
    'publications',
  ];
  for (const table of readableTables) {
    assert.match(
      hardening,
      new RegExp(
        `revoke all privileges on table public\\.${table} from public, anon, authenticated`,
        'i',
      ),
      `missing full client revoke for ${table}`,
    );
    assert.match(
      hardening,
      new RegExp(`grant select on table public\\.${table} to authenticated`, 'i'),
      `missing authenticated SELECT grant for ${table}`,
    );
  }
  for (const privateTable of ['worker_nodes', '_reelops_migrations']) {
    assert.match(
      hardening,
      new RegExp(
        `revoke all privileges on table public\\.${privateTable} from public, anon, authenticated`,
        'i',
      ),
    );
    assert.doesNotMatch(
      hardening,
      new RegExp(`grant select on table public\\.${privateTable}`, 'i'),
    );
  }
});

test('SECURITY DEFINER entry points use explicit execution grants', () => {
  for (const signature of [
    'is_tenant_member\\(uuid\\)',
    'has_tenant_role\\(uuid, public\\.member_role\\[\\]\\)',
    'user_role_for_tenant\\(uuid\\)',
    'onboard_tenant\\(text, text, text\\)',
  ]) {
    assert.match(
      hardening,
      new RegExp(
        `revoke all privileges on function public\\.${signature} from public, anon, authenticated`,
        'i',
      ),
    );
    assert.match(
      hardening,
      new RegExp(`grant execute on function public\\.${signature} to authenticated`, 'i'),
    );
  }
  assert.match(
    hardening,
    /revoke all privileges on function public\.create_tenant_with_owner\(text, text, text\) from public, anon, authenticated/i,
  );
  assert.doesNotMatch(hardening, /grant execute on function public\.create_tenant_with_owner/i);
});

test('tenant and storage scopes are enforced by database constraints', () => {
  for (const constraint of [
    'cameras_restaurant_tenant_fkey',
    'moments_restaurant_tenant_fkey',
    'reels_restaurant_tenant_fkey',
    'job_events_reel_tenant_fkey',
    'publications_reel_tenant_fkey',
    'reels_moment_scope_fkey',
    'cameras_storage_prefix_canonical_check',
    'cameras_last_segment_scope_check',
    'reels_output_path_scope_check',
    'reels_thumbnail_path_scope_check',
  ])
    assert.match(
      allSql,
      new RegExp(`constraint\\s+${constraint}\\b`, 'i'),
      `missing ${constraint}`,
    );

  assert.match(hardening, /foreign key \(moment_id, tenant_id, restaurant_id\)/i);
  assert.match(hardening, /storage_prefix = 'raw\/' \|\| tenant_id::text/i);
  assert.match(hardening, /'generated\/reels\/' \|\| tenant_id::text/i);
});

test('highlight engine tables are client read-only and tenant-scoped', () => {
  const engine = migrations.find(({ name }) => name === '0008_highlight_engine.sql')?.sql ?? '';
  for (const table of ['highlight_candidates', 'highlight_scores']) {
    assert.match(
      engine,
      new RegExp(
        `revoke all privileges on table public\\.${table} from public, anon, authenticated`,
        'i',
      ),
    );
    assert.match(
      engine,
      new RegExp(`grant select on table public\\.${table} to authenticated`, 'i'),
    );
  }
  assert.match(
    engine,
    /create policy highlight_candidates_read on public.highlight_candidates\s+for select/i,
  );
  assert.match(
    engine,
    /create policy highlight_scores_read on public.highlight_scores\s+for select/i,
  );
  assert.doesNotMatch(
    engine,
    /create policy \S+ on public.highlight_candidates\s+for (all|insert|update|delete)/i,
  );
  assert.match(engine, /recordings_object_key_canonical_check/i);
  assert.match(engine, /highlight_candidates_restaurant_tenant_fkey/i);
  assert.match(engine, /offset_bucket/i);
});

test('cenapronta layout isolates SaaS paths and daily WhatsApp digests', () => {
  const layout = migrations.find(({ name }) => name === '0009_cenapronta_layout.sql')?.sql ?? '';
  assert.match(layout, /cenapronta\/raw\//);
  assert.match(layout, /cenapronta\/people\//);
  assert.match(layout, /create table public\.daily_digests/i);
  assert.match(layout, /create policy daily_digests_read on public.daily_digests\s+for select/i);
  assert.doesNotMatch(
    layout,
    /create policy \S+ on public.daily_digests\s+for (all|insert|update|delete)/i,
  );
  assert.match(
    layout,
    /revoke all privileges on table public\.daily_digests from public, anon, authenticated/i,
  );
  assert.match(layout, /grant select on table public\.daily_digests to authenticated/i);
  assert.match(allSql, /storage_prefix = 'cenapronta\/raw\/' \|\| tenant_id::text/i);
});

test('platform admin tables stay private and are not tenant roles', () => {
  const admin = migrations.find(({ name }) => name === '0015_platform_admin.sql')?.sql ?? '';
  for (const table of ['platform_admins', 'admin_audit_events', 'platform_program_presets']) {
    assert.match(
      admin,
      new RegExp(
        `revoke all privileges on table public\\.${table} from public, anon, authenticated`,
        'i',
      ),
    );
    assert.doesNotMatch(admin, new RegExp(`grant select on table public\\.${table}`, 'i'));
    assert.doesNotMatch(admin, new RegExp(`create policy \\S+ on public\\.${table}`, 'i'));
  }
  assert.doesNotMatch(admin, /member_role/);
  assert.match(admin, /platform_program_presets_live_uidx/);
});

test('ingest and moment idempotency unique indexes exist', () => {
  const recording =
    migrations.find(({ name }) => name === '0013_recording_timestamp_idempotency.sql')?.sql ?? '';
  const moment =
    migrations.find(({ name }) => name === '0014_moment_client_request_id.sql')?.sql ?? '';
  assert.match(recording, /recordings_idempotency_key_uidx/);
  assert.match(moment, /moments_tenant_client_request_uidx/);
  assert.match(moment, /client_request_id/);
});
