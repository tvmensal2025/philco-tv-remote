grant select on table public.activity_events to authenticated;
grant select on table public.recordings to authenticated;
grant select on table public.motion_events to authenticated;

drop policy if exists recording_write on public.recordings;
drop policy if exists motion_write on public.motion_events;
