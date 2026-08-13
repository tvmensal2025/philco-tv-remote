create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'admin', 'editor', 'viewer');
create type public.reel_status as enum ('queued','collecting','analyzing','rendering','uploading','ready','approved','publishing','published','discarded','failed');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'starter',
  created_at timestamptz not null default now()
);
create table public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  logo_path text,
  settings jsonb not null default '{"window_before":12,"window_after":8,"output_ratio":"9:16"}',
  created_at timestamptz not null default now()
);
create table public.cameras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  position smallint not null check (position between 1 and 16),
  source_type text not null default 'minio' check (source_type in ('minio','rtsp','nvr')),
  source_config jsonb not null default '{}',
  storage_prefix text not null,
  enabled boolean not null default true,
  unique (restaurant_id, position)
);
create table public.moments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  label text,
  created_at timestamptz not null default now()
);
create table public.reels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  moment_id uuid not null references public.moments(id) on delete cascade,
  status public.reel_status not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  title text,
  output_path text,
  thumbnail_path text,
  duration_seconds numeric(8,2),
  score numeric(5,2),
  error_code text,
  error_message text,
  metadata jsonb not null default '{}',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.job_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reel_id uuid not null references public.reels(id) on delete cascade,
  status public.reel_status not null,
  progress smallint not null default 0,
  message text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.publications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reel_id uuid not null references public.reels(id) on delete cascade,
  provider text not null,
  status text not null default 'queued',
  external_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reels_tenant_status_created_idx on public.reels(tenant_id, status, created_at desc);
create index moments_restaurant_occurred_idx on public.moments(restaurant_id, occurred_at desc);
create index cameras_restaurant_enabled_idx on public.cameras(restaurant_id) where enabled;
create index job_events_reel_created_idx on public.job_events(reel_id, created_at desc);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger reels_touch before update on public.reels for each row execute function public.touch_updated_at();
create trigger publications_touch before update on public.publications for each row execute function public.touch_updated_at();

create or replace function public.is_tenant_member(target uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.tenant_members where tenant_id = target and user_id = auth.uid())
$$;
create or replace function public.has_tenant_role(target uuid, roles public.member_role[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.tenant_members where tenant_id = target and user_id = auth.uid() and role = any(roles))
$$;

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.restaurants enable row level security;
alter table public.cameras enable row level security;
alter table public.moments enable row level security;
alter table public.reels enable row level security;
alter table public.job_events enable row level security;
alter table public.publications enable row level security;

create policy tenant_read on public.tenants for select using (public.is_tenant_member(id));
create policy member_read on public.tenant_members for select using (public.is_tenant_member(tenant_id));
create policy restaurant_read on public.restaurants for select using (public.is_tenant_member(tenant_id));
create policy restaurant_write on public.restaurants for all using (public.has_tenant_role(tenant_id, array['owner','admin']::public.member_role[]));
create policy camera_read on public.cameras for select using (public.is_tenant_member(tenant_id));
create policy camera_write on public.cameras for all using (public.has_tenant_role(tenant_id, array['owner','admin']::public.member_role[]));
create policy moment_read on public.moments for select using (public.is_tenant_member(tenant_id));
create policy moment_insert on public.moments for insert with check (public.has_tenant_role(tenant_id, array['owner','admin','editor']::public.member_role[]));
create policy reel_read on public.reels for select using (public.is_tenant_member(tenant_id));
create policy reel_write on public.reels for update using (public.has_tenant_role(tenant_id, array['owner','admin','editor']::public.member_role[]));
create policy event_read on public.job_events for select using (public.is_tenant_member(tenant_id));
create policy publication_read on public.publications for select using (public.is_tenant_member(tenant_id));
create policy publication_write on public.publications for all using (public.has_tenant_role(tenant_id, array['owner','admin','editor']::public.member_role[]));

alter publication supabase_realtime add table public.reels;
