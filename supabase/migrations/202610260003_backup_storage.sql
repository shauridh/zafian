-- Fase 2: cloud backup satu arah.
--
-- Isi backup dienkripsi di klien (AES-GCM 256, kunci dari PBKDF2) sebelum
-- diunggah, sehingga bucket ini hanya menyimpan blob terenkripsi. Database
-- hanya menyimpan metadata di public.outlet_snapshots. Aplikasi tetap
-- membaca/menulis IndexedDB; cloud bersifat salinan, bukan sumber kebenaran.

-- ---------------------------------------------------------------------------
-- Bucket privat
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pos-backups',
  'pos-backups',
  false,
  10485760,
  array['application/json', 'application/octet-stream', 'text/plain']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Helper path: segmen pertama nama objek adalah outlet_id
-- ---------------------------------------------------------------------------

create or replace function public.snapshot_outlet_from_path(object_name text)
returns uuid
language sql
immutable
set search_path = public, storage
as $$
  select case
    when coalesce((storage.foldername(object_name))[1], '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(object_name))[1])::uuid
    else null
  end;
$$;

comment on function public.snapshot_outlet_from_path(text) is
  'Mengambil outlet_id dari path snapshot pos-backups/<outlet_id>/<file>. Null jika bukan UUID.';

-- ---------------------------------------------------------------------------
-- Policy Storage: hanya owner outlet yang boleh baca/tulis folder outletnya
-- ---------------------------------------------------------------------------

drop policy if exists pos_backups_owner_read on storage.objects;
create policy pos_backups_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pos-backups'
    and public.is_outlet_owner(public.snapshot_outlet_from_path(name))
  );

drop policy if exists pos_backups_owner_insert on storage.objects;
create policy pos_backups_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pos-backups'
    and public.is_outlet_owner(public.snapshot_outlet_from_path(name))
  );

drop policy if exists pos_backups_owner_update on storage.objects;
create policy pos_backups_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pos-backups'
    and public.is_outlet_owner(public.snapshot_outlet_from_path(name))
  )
  with check (
    bucket_id = 'pos-backups'
    and public.is_outlet_owner(public.snapshot_outlet_from_path(name))
  );

drop policy if exists pos_backups_owner_delete on storage.objects;
create policy pos_backups_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pos-backups'
    and public.is_outlet_owner(public.snapshot_outlet_from_path(name))
  );
