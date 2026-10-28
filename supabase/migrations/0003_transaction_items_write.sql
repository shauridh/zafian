-- 0003 — izin tulis `transaction_items` untuk trigger transaksi.
--
-- Tabel `transactions` menyalin baris item ke `transaction_items` lewat trigger
-- `sync_transaction_items`. Bila trigger berjalan sebagai invoker (atau
-- definer-nya bukan pemilik tabel), INSERT/DELETE ditolak RLS karena 0002 hanya
-- memberi policy SELECT untuk tabel item. Aplikasi tidak pernah menulis tabel
-- item secara langsung, jadi policy di bawah hanya membuka jalur trigger:
-- baris tetap dibatasi ke outlet tempat akun menjadi anggota.
--
-- Jalankan sekali setelah 0002_rls.sql. Script ini idempoten (policy di-drop
-- lebih dulu), jadi aman diulang bila perlu.

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'sync_transaction_items'
  ) then
    execute 'alter function public.sync_transaction_items() security definer';
    execute 'alter function public.sync_transaction_items() set search_path = public';
  end if;
end;
$$;

drop policy if exists transaction_items_member_insert on public.transaction_items;
create policy transaction_items_member_insert on public.transaction_items
  for insert to public
  with check (public.is_outlet_member(outlet_id));

drop policy if exists transaction_items_member_delete on public.transaction_items;
create policy transaction_items_member_delete on public.transaction_items
  for delete to public
  using (public.is_outlet_member(outlet_id));

grant select, insert, delete on public.transaction_items to authenticated;
