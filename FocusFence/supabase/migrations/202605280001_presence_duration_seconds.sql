alter table public.presence_records
  add column if not exists duration_seconds double precision;
