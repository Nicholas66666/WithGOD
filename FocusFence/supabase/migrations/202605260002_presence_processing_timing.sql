alter table public.presence_records
  add column if not exists processing_timing jsonb not null default '{}'::jsonb;
