-- Client roles are intentionally read-only. All mutations flow through the
-- authenticated API/RPC layer and are executed with the service role.
drop policy if exists restaurant_write on public.restaurants;
drop policy if exists camera_write on public.cameras;
drop policy if exists moment_insert on public.moments;
drop policy if exists reel_write on public.reels;
drop policy if exists publication_write on public.publications;

-- Remove any differently-named write policy that may exist because of drift.
do $$
declare
  unsafe_policy record;
begin
  for unsafe_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'tenants', 'tenant_members', 'restaurants', 'cameras',
        'moments', 'reels', 'job_events', 'publications', 'worker_nodes'
      ])
      and cmd <> 'SELECT'
  loop
    execute format(
      'drop policy %I on %I.%I',
      unsafe_policy.policyname,
      unsafe_policy.schemaname,
      unsafe_policy.tablename
    );
  end loop;
end $$;

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.restaurants enable row level security;
alter table public.cameras enable row level security;
alter table public.moments enable row level security;
alter table public.reels enable row level security;
alter table public.job_events enable row level security;
alter table public.publications enable row level security;
alter table public.worker_nodes enable row level security;

-- RLS is the row boundary; table grants are a second boundary. Anonymous
-- clients receive no application-table privileges, while authenticated users
-- can only read rows admitted by the SELECT policies created in 0001.
revoke all privileges on table public.tenants from public, anon, authenticated;
revoke all privileges on table public.tenant_members from public, anon, authenticated;
revoke all privileges on table public.restaurants from public, anon, authenticated;
revoke all privileges on table public.cameras from public, anon, authenticated;
revoke all privileges on table public.moments from public, anon, authenticated;
revoke all privileges on table public.reels from public, anon, authenticated;
revoke all privileges on table public.job_events from public, anon, authenticated;
revoke all privileges on table public.publications from public, anon, authenticated;
revoke all privileges on table public.worker_nodes from public, anon, authenticated;
revoke all privileges on table public._reelops_migrations from public, anon, authenticated;
revoke all privileges on sequence public.job_events_id_seq from public, anon, authenticated;

grant select on table public.tenants to authenticated;
grant select on table public.tenant_members to authenticated;
grant select on table public.restaurants to authenticated;
grant select on table public.cameras to authenticated;
grant select on table public.moments to authenticated;
grant select on table public.reels to authenticated;
grant select on table public.job_events to authenticated;
grant select on table public.publications to authenticated;

revoke create on schema public from public, anon, authenticated;
grant usage on schema public to authenticated;

-- SECURITY DEFINER functions never rely on PostgreSQL's default EXECUTE grant
-- to PUBLIC. Only the two user-facing read/onboarding contracts are exposed.
revoke all privileges on function public.touch_updated_at() from public, anon, authenticated;
revoke all privileges on function public.is_tenant_member(uuid) from public, anon, authenticated;
revoke all privileges on function public.has_tenant_role(uuid, public.member_role[]) from public, anon, authenticated;
revoke all privileges on function public.user_role_for_tenant(uuid) from public, anon, authenticated;
revoke all privileges on function public.onboard_tenant(text, text, text) from public, anon, authenticated;
revoke all privileges on function public.create_tenant_with_owner(text, text, text) from public, anon, authenticated;

grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.has_tenant_role(uuid, public.member_role[]) to authenticated;
grant execute on function public.user_role_for_tenant(uuid) to authenticated;
grant execute on function public.onboard_tenant(text, text, text) to authenticated;

-- New objects are private until a later migration grants the minimum access.
alter default privileges in schema public revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public revoke all privileges on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- A reel's moment must belong to the same restaurant as well as the same
-- tenant. 0003 already enforces the other tenant-scoped relationships.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'moments_id_tenant_restaurant_unique'
      and conrelid = 'public.moments'::regclass
  ) then
    alter table public.moments
      add constraint moments_id_tenant_restaurant_unique
      unique (id, tenant_id, restaurant_id);
  end if;
end $$;

alter table public.reels drop constraint if exists reels_moment_tenant_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reels_moment_scope_fkey'
      and conrelid = 'public.reels'::regclass
  ) then
    alter table public.reels
      add constraint reels_moment_scope_fkey
      foreign key (moment_id, tenant_id, restaurant_id)
      references public.moments(id, tenant_id, restaurant_id)
      on delete cascade;
  end if;
end $$;

-- Object paths are also tenant boundaries because the worker's MinIO account
-- can read the whole bucket.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cameras_storage_prefix_canonical_check'
      and conrelid = 'public.cameras'::regclass
  ) then
    alter table public.cameras
      add constraint cameras_storage_prefix_canonical_check
      check (
        storage_prefix = 'raw/' || tenant_id::text || '/' || restaurant_id::text || '/camera-' || position::text
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cameras_last_segment_scope_check'
      and conrelid = 'public.cameras'::regclass
  ) then
    alter table public.cameras
      add constraint cameras_last_segment_scope_check
      check (last_segment_path is null or last_segment_path like storage_prefix || '/%');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reels_output_path_scope_check'
      and conrelid = 'public.reels'::regclass
  ) then
    alter table public.reels
      add constraint reels_output_path_scope_check
      check (
        output_path is null or output_path like
          'generated/reels/' || tenant_id::text || '/' || restaurant_id::text || '/' || id::text || '/%'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reels_thumbnail_path_scope_check'
      and conrelid = 'public.reels'::regclass
  ) then
    alter table public.reels
      add constraint reels_thumbnail_path_scope_check
      check (
        thumbnail_path is null or thumbnail_path like
          'generated/reels/' || tenant_id::text || '/' || restaurant_id::text || '/' || id::text || '/%'
      );
  end if;
end $$;
