create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  camera_id uuid not null references public.cameras(id) on delete cascade,
  object_key text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds numeric(8,2),
  size_bytes bigint,
  codec text,
  resolution text,
  motion_event_id uuid,
  created_at timestamptz not null default now()
);

create table public.motion_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  camera_id uuid not null references public.cameras(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  source text not null check (source in ('native_camera_motion', 'nvr_motion', 'webhook', 'manual')),
  recording_id uuid references public.recordings(id) on delete set null,
  motion_score numeric(5,2),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.recordings add constraint fk_motion_event foreign key (motion_event_id) references public.motion_events(id) on delete set null;

create index recordings_camera_started_idx on public.recordings(camera_id, started_at desc);
create index motion_events_camera_started_idx on public.motion_events(camera_id, started_at desc);

alter table public.recordings enable row level security;
alter table public.motion_events enable row level security;

create policy recording_read on public.recordings for select using (public.is_tenant_member(tenant_id));
create policy recording_write on public.recordings for all using (public.has_tenant_role(tenant_id, array['owner','admin']::public.member_role[]));
create policy motion_read on public.motion_events for select using (public.is_tenant_member(tenant_id));
create policy motion_write on public.motion_events for all using (public.has_tenant_role(tenant_id, array['owner','admin']::public.member_role[]));

alter table public.moments add column type text not null default 'manual' check (type in ('manual', 'motion', 'automatic', 'scheduled', 'imported'));
alter table public.moments add column category text;
alter table public.moments add column priority_score smallint not null default 0;
