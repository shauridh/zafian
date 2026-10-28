-- KHUSUS UJI LOKAL (PGlite). Jangan dijalankan di project Supabase.
-- Supabase sudah menyediakan schema auth, auth.uid(), dan role anon/authenticated.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
$$;

-- Stub schema storage milik Supabase agar migration bucket/policy bisa diuji lokal.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata jsonb
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select coalesce(
    (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)],
    '{}'::text[]
  )
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select, insert on storage.buckets to authenticated;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('22222222-2222-4222-8222-222222222222', 'owner-a@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'kasir-a@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'owner-b@example.test')
on conflict (id) do nothing;
