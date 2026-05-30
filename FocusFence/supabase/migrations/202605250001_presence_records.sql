create extension if not exists pgcrypto;

create table if not exists public.presence_records (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source text not null default 'watch',
  client_source text,
  request_id text,
  audio_path text,
  voice_path text,
  transcript text not null default '',
  type text not null default 'unknown',
  summary text not null default '',
  tags jsonb not null default '[]'::jsonb,
  watch_response jsonb not null default '{}'::jsonb,
  detail jsonb not null default '{}'::jsonb,
  response_mode text not null default 'watchText',
  state text not null default 'ready',
  processing_ms integer,
  error_message text
);

create index if not exists presence_records_created_at_idx
  on public.presence_records (created_at desc);

create index if not exists presence_records_type_idx
  on public.presence_records (type);

create index if not exists presence_records_tags_idx
  on public.presence_records using gin (tags);

create or replace function public.set_presence_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists presence_records_set_updated_at on public.presence_records;
create trigger presence_records_set_updated_at
before update on public.presence_records
for each row
execute function public.set_presence_records_updated_at();

alter table public.presence_records enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'presence-audio',
  'presence-audio',
  false,
  25000000,
  array['audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/aac', 'application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
