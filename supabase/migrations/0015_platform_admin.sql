-- Platform control plane. Not a tenant role.
-- Authenticated clients have zero privileges; APIs use the service role after requirePlatformAdmin().

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'support', 'readonly')),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  action text not null check (char_length(action) between 2 and 80),
  target_tenant_id uuid,
  target_restaurant_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_events_created_idx
  on public.admin_audit_events (created_at desc);

create table if not exists public.platform_program_presets (
  id uuid primary key default gen_random_uuid(),
  program text not null check (program in ('casa', 'oficio', 'assinatura', 'pulso')),
  version integer not null check (version >= 1),
  status text not null check (status in ('draft', 'published', 'archived')),
  name text not null default 'Padrão validado',
  spec jsonb not null,
  created_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (program, version)
);

create unique index if not exists platform_program_presets_live_uidx
  on public.platform_program_presets (program, status)
  where status in ('draft', 'published');

create index if not exists platform_program_presets_program_status_idx
  on public.platform_program_presets (program, status);

alter table public.platform_admins enable row level security;
alter table public.admin_audit_events enable row level security;
alter table public.platform_program_presets enable row level security;

revoke all privileges on table public.platform_admins from public, anon, authenticated;
revoke all privileges on table public.admin_audit_events from public, anon, authenticated;
revoke all privileges on table public.platform_program_presets from public, anon, authenticated;
