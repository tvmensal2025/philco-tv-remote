create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;

alter table public.tenants add column if not exists settings jsonb not null default '{}';
alter table public.restaurants add column if not exists updated_at timestamptz not null default now();
alter table public.cameras add column if not exists last_seen_at timestamptz;
alter table public.cameras add column if not exists last_segment_path text;
alter table public.cameras add column if not exists updated_at timestamptz not null default now();
alter table public.reels add column if not exists caption text;

create table if not exists public.worker_nodes (
  id text primary key,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);
alter table public.worker_nodes enable row level security;

drop trigger if exists restaurants_touch on public.restaurants;
create trigger restaurants_touch before update on public.restaurants for each row execute function public.touch_updated_at();
drop trigger if exists cameras_touch on public.cameras;
create trigger cameras_touch before update on public.cameras for each row execute function public.touch_updated_at();

create index if not exists cameras_last_seen_idx on public.cameras(tenant_id, last_seen_at desc);
create unique index if not exists publications_one_active_provider_idx on public.publications(reel_id, provider) where status in ('queued', 'publishing', 'published');

alter table public.restaurants add constraint restaurants_id_tenant_unique unique (id, tenant_id);
alter table public.moments add constraint moments_id_tenant_unique unique (id, tenant_id);
alter table public.reels add constraint reels_id_tenant_unique unique (id, tenant_id);
alter table public.cameras drop constraint if exists cameras_restaurant_id_fkey;
alter table public.cameras add constraint cameras_restaurant_tenant_fkey foreign key (restaurant_id, tenant_id) references public.restaurants(id, tenant_id) on delete cascade;
alter table public.moments drop constraint if exists moments_restaurant_id_fkey;
alter table public.moments add constraint moments_restaurant_tenant_fkey foreign key (restaurant_id, tenant_id) references public.restaurants(id, tenant_id) on delete cascade;
alter table public.reels drop constraint if exists reels_restaurant_id_fkey;
alter table public.reels drop constraint if exists reels_moment_id_fkey;
alter table public.reels add constraint reels_restaurant_tenant_fkey foreign key (restaurant_id, tenant_id) references public.restaurants(id, tenant_id) on delete cascade;
alter table public.reels add constraint reels_moment_tenant_fkey foreign key (moment_id, tenant_id) references public.moments(id, tenant_id) on delete cascade;
alter table public.job_events drop constraint if exists job_events_reel_id_fkey;
alter table public.job_events add constraint job_events_reel_tenant_fkey foreign key (reel_id, tenant_id) references public.reels(id, tenant_id) on delete cascade;
alter table public.publications drop constraint if exists publications_reel_id_fkey;
alter table public.publications add constraint publications_reel_tenant_fkey foreign key (reel_id, tenant_id) references public.reels(id, tenant_id) on delete cascade;

drop policy if exists restaurant_write on public.restaurants;
drop policy if exists camera_write on public.cameras;
drop policy if exists moment_insert on public.moments;
drop policy if exists reel_write on public.reels;
drop policy if exists publication_write on public.publications;

create or replace function public.onboard_tenant(
  organization_name text,
  restaurant_name text,
  user_timezone text default 'America/Sao_Paulo'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  new_tenant_id uuid;
  new_restaurant_id uuid;
  safe_slug text;
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if exists(select 1 from public.tenant_members where user_id = current_user_id) then
    raise exception 'user already belongs to an organization';
  end if;

  if length(trim(organization_name)) not between 2 and 80 or length(trim(restaurant_name)) not between 2 and 80 then
    raise exception 'invalid organization or restaurant name';
  end if;
  safe_slug := trim(both '-' from regexp_replace(lower(extensions.unaccent(organization_name)), '[^a-z0-9]+', '-', 'g'));
  if safe_slug = '' then safe_slug := 'restaurante'; end if;
  safe_slug := safe_slug || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6);

  insert into public.tenants(name, slug) values (trim(organization_name), safe_slug) returning id into new_tenant_id;
  insert into public.tenant_members(tenant_id, user_id, role) values (new_tenant_id, current_user_id, 'owner');
  insert into public.restaurants(tenant_id, name, timezone)
    values (new_tenant_id, trim(restaurant_name), user_timezone)
    returning id into new_restaurant_id;

  for i in 1..4 loop
    insert into public.cameras(tenant_id, restaurant_id, name, position, storage_prefix)
      values (
        new_tenant_id,
        new_restaurant_id,
        'Camera ' || i,
        i,
        'raw/' || new_tenant_id || '/' || new_restaurant_id || '/camera-' || i
      );
  end loop;

  return jsonb_build_object('tenantId', new_tenant_id, 'restaurantId', new_restaurant_id);
end $$;

revoke all on function public.onboard_tenant(text, text, text) from public;
grant execute on function public.onboard_tenant(text, text, text) to authenticated;
revoke all on function public.create_tenant_with_owner(text, text, text) from public;
revoke all on function public.create_tenant_with_owner(text, text, text) from authenticated;

create or replace function public.user_role_for_tenant(target uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.tenant_members where tenant_id = target and user_id = auth.uid()
$$;
revoke all on function public.user_role_for_tenant(uuid) from public;
grant execute on function public.user_role_for_tenant(uuid) to authenticated;

revoke all on table public._reelops_migrations from public, anon, authenticated;
