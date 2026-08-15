-- Scale indexes: tenant-scoped listings, reel-by-moment, worker heartbeat cleanup.
create index if not exists moments_tenant_occurred_idx
  on public.moments (tenant_id, occurred_at desc);

create index if not exists reels_moment_idx
  on public.reels (moment_id);

create index if not exists worker_nodes_last_seen_idx
  on public.worker_nodes (last_seen_at desc);
