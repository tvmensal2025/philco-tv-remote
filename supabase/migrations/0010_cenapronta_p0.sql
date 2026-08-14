alter table public.cameras
  add column if not exists camera_time_offset_ms integer not null default 0;

alter table public.recordings
  add column if not exists checksum text;

create index if not exists recordings_restaurant_window_idx
  on public.recordings (restaurant_id, started_at, ended_at);

create index if not exists recordings_camera_window_idx
  on public.recordings (camera_id, started_at, ended_at);

comment on column public.cameras.camera_time_offset_ms is
  'Ajuste fino do relógio da câmera em ms. Default 0.';
