create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  message text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index activity_events_tenant_restaurant_idx on public.activity_events(tenant_id, restaurant_id, created_at desc);

alter table public.activity_events enable row level security;
create policy activity_read on public.activity_events for select using (public.is_tenant_member(tenant_id));

alter publication supabase_realtime add table public.activity_events;
