-- 0004 — hapus shift untuk restore/hapus data.
--
-- `saveStore` menghapus baris yang tidak ada lagi di snapshot; saat pengguna
-- memulihkan backup lama, shift yang tidak ada di backup ikut dihapus. Tabel
-- `shifts` hanya punya policy SELECT/INSERT/UPDATE, sehingga DELETE menjadi
-- no-op tanpa error: data yatim tetap tinggal di database dan muncul lagi
-- setelah reload. Policy ini hanya untuk owner outlet karena shift adalah
-- catatan audit kas.
--
-- Jalankan sekali setelah 0003. Idempoten (policy di-drop lebih dulu).

drop policy if exists shifts_owner_delete on public.shifts;
create policy shifts_owner_delete on public.shifts
  for delete to authenticated
  using (public.is_outlet_owner(outlet_id));
