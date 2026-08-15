-- Sofia sessions + RTSP passwords off the authenticated cameras row.

create table if not exists public.sofia_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  restaurant_id uuid not null,
  status text not null default 'waiting_agent'
    check (status in (
      'idle',
      'waiting_agent',
      'scanning',
      'found',
      'awaiting_confirm',
      'configuring',
      'ready',
      'need_folder',
      'failed'
    )),
  discoveries jsonb not null default '[]',
  selection jsonb not null default '{}',
  agent_seen_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id)
);

create table if not exists public.sofia_secrets (
  restaurant_id uuid primary key,
  tenant_id uuid not null,
  username text,
  password text,
  updated_at timestamptz not null default now()
);

create table if not exists public.camera_ingest_secrets (
  camera_id uuid primary key references public.cameras(id) on delete cascade,
  tenant_id uuid not null,
  rtsp_password text,
  updated_at timestamptz not null default now()
);

alter table public.sofia_sessions enable row level security;
alter table public.sofia_secrets enable row level security;
alter table public.camera_ingest_secrets enable row level security;

revoke all privileges on table public.sofia_sessions from public, anon, authenticated;
revoke all privileges on table public.sofia_secrets from public, anon, authenticated;
revoke all privileges on table public.camera_ingest_secrets from public, anon, authenticated;

grant select on table public.sofia_sessions to authenticated;

drop policy if exists sofia_session_read on public.sofia_sessions;
create policy sofia_session_read on public.sofia_sessions
  for select using (public.is_tenant_member(tenant_id));

comment on table public.sofia_sessions is
  'Sofia discovery UI state. Passwords live in sofia_secrets / camera_ingest_secrets.';
comment on table public.sofia_secrets is
  'One-shot DVR password for the local agent. Never granted to authenticated.';
comment on table public.camera_ingest_secrets is
  'RTSP passwords. Service role only.';
