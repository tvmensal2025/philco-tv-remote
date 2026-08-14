alter table public.recordings
  add column if not exists timestamp_source text,
  add column if not exists timestamp_confidence text,
  add column if not exists idempotency_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recordings_timestamp_source_check'
      and conrelid = 'public.recordings'::regclass
  ) then
    alter table public.recordings
      add constraint recordings_timestamp_source_check
      check (timestamp_source is null or timestamp_source in ('filename', 'nvr_pattern', 'file_metadata', 'filesystem_mtime', 'fallback'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'recordings_timestamp_confidence_check'
      and conrelid = 'public.recordings'::regclass
  ) then
    alter table public.recordings
      add constraint recordings_timestamp_confidence_check
      check (timestamp_confidence is null or timestamp_confidence in ('exact', 'derived', 'fallback'));
  end if;
end $$;

create unique index if not exists recordings_idempotency_key_uidx
  on public.recordings (idempotency_key)
  where idempotency_key is not null;

comment on column public.recordings.timestamp_source is
  'Como o horário do segmento foi obtido: filename, nvr_pattern, file_metadata, filesystem_mtime, fallback.';
comment on column public.recordings.timestamp_confidence is
  'exact = no nome do arquivo; derived = ffprobe/metadata; fallback = último recurso, não usar como verdade multicâmera.';
comment on column public.recordings.idempotency_key is
  'sha256(camera_id:checksum:started_at:ended_at). Impede Recording duplicado do mesmo arquivo.';
