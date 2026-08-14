alter table public.moments
  add column if not exists client_request_id uuid;

create unique index if not exists moments_tenant_client_request_uidx
  on public.moments (tenant_id, client_request_id)
  where client_request_id is not null;

comment on column public.moments.client_request_id is
  'UUID gerado pelo cliente. Impede 8 Reels no duplo clique de POST /api/moments.';
