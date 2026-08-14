-- Highlight engine: local FFmpeg index of NVR hours, Gemini only on short clips.
-- Client remains read-only; workers mutate via the service role.

alter table public.recordings
  add column if not exists index_status text not null default 'pending'
    check (index_status in ('pending', 'indexing', 'indexed', 'failed', 'skipped')),
  add column if not exists indexed_at timestamptz,
  add column if not exists index_error text;

alter table public.recordings
  drop constraint if exists recordings_object_key_canonical_check;
alter table public.recordings
  add constraint recordings_object_key_canonical_check
  check (object_key like 'raw/' || tenant_id::text || '/' || restaurant_id::text || '/%');

create unique index if not exists recordings_object_key_uidx on public.recordings (object_key);
alter table public.recordings drop constraint if exists recordings_object_key_key;
alter table public.recordings add constraint recordings_object_key_key unique using index recordings_object_key_uidx;
create index if not exists recordings_pending_index_idx
  on public.recordings (tenant_id, created_at)
  where index_status = 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recordings_id_tenant_unique'
      and conrelid = 'public.recordings'::regclass
  ) then
    alter table public.recordings
      add constraint recordings_id_tenant_unique unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cameras_id_tenant_unique'
      and conrelid = 'public.cameras'::regclass
  ) then
    alter table public.cameras
      add constraint cameras_id_tenant_unique unique (id, tenant_id);
  end if;
end $$;

create table public.highlight_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  restaurant_id uuid not null,
  camera_id uuid not null,
  recording_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  offset_seconds numeric(8,3) not null check (offset_seconds >= 0),
  duration_seconds numeric(8,3) not null check (duration_seconds > 0),
  offset_bucket integer not null,
  scene_score numeric(6,3),
  audio_lufs numeric(6,2),
  silence_ratio numeric(5,4),
  motion_score numeric(6,2),
  fused_score numeric(6,2) not null default 0,
  camera_count smallint not null default 1,
  status text not null default 'detected'
    check (status in ('detected', 'fused', 'analyzed', 'accepted', 'rejected', 'expired', 'quota')),
  source text not null default 'ffmpeg_scene'
    check (source in ('ffmpeg_scene', 'ebur128', 'motion', 'fused', 'heuristic')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint highlight_candidates_restaurant_tenant_fkey
    foreign key (restaurant_id, tenant_id)
    references public.restaurants(id, tenant_id)
    on delete cascade,
  constraint highlight_candidates_camera_tenant_fkey
    foreign key (camera_id, tenant_id)
    references public.cameras(id, tenant_id)
    on delete cascade,
  constraint highlight_candidates_recording_tenant_fkey
    foreign key (recording_id, tenant_id)
    references public.recordings(id, tenant_id)
    on delete cascade,
  unique (recording_id, offset_bucket)
);

create index highlight_candidates_restaurant_time_idx
  on public.highlight_candidates (tenant_id, restaurant_id, started_at desc);
create index highlight_candidates_status_idx
  on public.highlight_candidates (restaurant_id, status, started_at desc);

create table public.highlight_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  restaurant_id uuid not null,
  candidate_id uuid references public.highlight_candidates(id) on delete set null,
  moment_id uuid,
  provider text not null check (provider in ('gemini', 'heuristic')),
  food numeric(5,2) not null default 0,
  action numeric(5,2) not null default 0,
  visual numeric(5,2) not null default 0,
  marketing numeric(5,2) not null default 0,
  ambience numeric(5,2) not null default 0,
  overall numeric(5,2) not null default 0,
  caption_pt text,
  hashtags text[] not null default '{}',
  scenes jsonb not null default '[]',
  reason text,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint highlight_scores_restaurant_tenant_fkey
    foreign key (restaurant_id, tenant_id)
    references public.restaurants(id, tenant_id)
    on delete cascade,
  constraint highlight_scores_moment_scope_fkey
    foreign key (moment_id, tenant_id, restaurant_id)
    references public.moments(id, tenant_id, restaurant_id)
    on delete set null
);

create index highlight_scores_restaurant_idx
  on public.highlight_scores (tenant_id, restaurant_id, created_at desc);
create index highlight_scores_moment_idx
  on public.highlight_scores (moment_id)
  where moment_id is not null;

alter table public.highlight_candidates enable row level security;
alter table public.highlight_scores enable row level security;

create policy highlight_candidates_read on public.highlight_candidates
  for select using (public.is_tenant_member(tenant_id));
create policy highlight_scores_read on public.highlight_scores
  for select using (public.is_tenant_member(tenant_id));

revoke all privileges on table public.highlight_candidates from public, anon, authenticated;
revoke all privileges on table public.highlight_scores from public, anon, authenticated;
grant select on table public.highlight_candidates to authenticated;
grant select on table public.highlight_scores to authenticated;
