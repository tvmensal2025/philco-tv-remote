-- CENAPRONTA SaaS layout: nova pasta no MinIO, isolada do bucket igreen.
-- cenapronta/raw/{tenant}/{restaurant}/camera-N/{YYYY-MM-DD}/...
-- cenapronta/people/{tenant}/{restaurant}/{YYYY-MM-DD}/reels/01-titulo.mp4

alter table public.cameras drop constraint if exists cameras_storage_prefix_canonical_check;
alter table public.recordings drop constraint if exists recordings_object_key_canonical_check;
alter table public.reels drop constraint if exists reels_output_path_scope_check;
alter table public.reels drop constraint if exists reels_thumbnail_path_scope_check;

update public.cameras
  set last_segment_path = null
  where last_segment_path is not null
    and last_segment_path not like 'cenapronta/raw/' || tenant_id::text || '/' || restaurant_id::text || '/camera-' || position::text || '/%';

update public.cameras
  set storage_prefix = 'cenapronta/raw/' || tenant_id::text || '/' || restaurant_id::text || '/camera-' || position::text;

alter table public.cameras
  add constraint cameras_storage_prefix_canonical_check
  check (
    storage_prefix = 'cenapronta/raw/' || tenant_id::text || '/' || restaurant_id::text || '/camera-' || position::text
  );

alter table public.recordings
  add constraint recordings_object_key_canonical_check
  check (
    object_key like 'cenapronta/raw/' || tenant_id::text || '/' || restaurant_id::text || '/%'
    or object_key like 'raw/' || tenant_id::text || '/' || restaurant_id::text || '/%'
  );

alter table public.reels
  add constraint reels_output_path_scope_check
  check (
    output_path is null
    or output_path like 'cenapronta/people/' || tenant_id::text || '/' || restaurant_id::text || '/%'
    or output_path like 'generated/reels/' || tenant_id::text || '/' || restaurant_id::text || '/%'
  );

alter table public.reels
  add constraint reels_thumbnail_path_scope_check
  check (
    thumbnail_path is null
    or thumbnail_path like 'cenapronta/people/' || tenant_id::text || '/' || restaurant_id::text || '/%'
    or thumbnail_path like 'generated/reels/' || tenant_id::text || '/' || restaurant_id::text || '/%'
  );

create or replace function public.create_tenant_with_owner(tenant_name text, tenant_slug text, restaurant_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_tenant uuid; new_restaurant uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  insert into tenants(name, slug) values (tenant_name, tenant_slug) returning id into new_tenant;
  insert into tenant_members(tenant_id, user_id, role) values (new_tenant, auth.uid(), 'owner');
  insert into restaurants(tenant_id, name) values (new_tenant, restaurant_name) returning id into new_restaurant;
  for i in 1..4 loop
    insert into cameras(tenant_id, restaurant_id, name, position, storage_prefix)
    values (new_tenant, new_restaurant, 'Câmera ' || i, i, 'cenapronta/raw/' || new_tenant || '/' || new_restaurant || '/camera-' || i);
  end loop;
  return new_tenant;
end $$;

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
        'cenapronta/raw/' || new_tenant_id || '/' || new_restaurant_id || '/camera-' || i
      );
  end loop;

  return jsonb_build_object('tenantId', new_tenant_id, 'restaurantId', new_restaurant_id);
end $$;

create table public.daily_digests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  restaurant_id uuid not null,
  day date not null,
  reel_ids uuid[] not null default '{}',
  object_paths text[] not null default '{}',
  status text not null default 'queued'
    check (status in ('queued', 'copied', 'sent', 'skipped', 'failed')),
  whatsapp_to text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint daily_digests_restaurant_tenant_fkey
    foreign key (restaurant_id, tenant_id)
    references public.restaurants(id, tenant_id)
    on delete cascade,
  unique (restaurant_id, day)
);

create index daily_digests_tenant_day_idx on public.daily_digests (tenant_id, day desc);

alter table public.daily_digests enable row level security;
create policy daily_digests_read on public.daily_digests
  for select using (public.is_tenant_member(tenant_id));
revoke all privileges on table public.daily_digests from public, anon, authenticated;
grant select on table public.daily_digests to authenticated;
