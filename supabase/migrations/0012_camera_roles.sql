alter table public.cameras
  add column if not exists role text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cameras_role_check'
      and conrelid = 'public.cameras'::regclass
  ) then
    alter table public.cameras
      add constraint cameras_role_check
      check (role is null or role in ('master', 'side', 'food', 'ambience'));
  end if;
end $$;

update public.cameras
set role = case position
  when 2 then 'side'
  when 3 then 'food'
  when 4 then 'ambience'
  else 'master'
end
where role is null;
