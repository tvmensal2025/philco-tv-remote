#!/bin/sh
set -eu

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL não foi preenchida."
  exit 1
fi

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c 'create table if not exists public._reelops_migrations (name text primary key, applied_at timestamptz not null default now())'

for file in /migrations/*.sql; do
  name="$(basename "$file")"
  applied="$(psql "$SUPABASE_DB_URL" -tAc "select 1 from public._reelops_migrations where name = '$name'")"
  if [ "$applied" = "1" ]; then
    echo "Já aplicada: $name"
    continue
  fi
  echo "Aplicando: $name"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f "$file" -c "insert into public._reelops_migrations(name) values ('$name')"
done
