# Supabase — Sabana POS (online-only)

Aplikasi memakai Supabase sebagai **sumber kebenaran**. Tanpa env Supabase, app
berjalan mode lokal untuk pengembangan; build produksi wajib memakai env.

## 1. Buat project & jalankan migration

1. Buat project di <https://supabase.com/dashboard> (region terdekat).
2. Buka **SQL Editor**, jalankan berurutan:
   - `migrations/0001_init.sql` — tabel, index, trigger, RPC pembuatan outlet.
   - `migrations/0002_rls.sql` — RLS per outlet + hak akses.
   - `migrations/0003_transaction_items_write.sql` — izin tulis baris item
     untuk trigger transaksi. **Wajib**: tanpa ini pembayaran ditolak RLS
     dengan pesan `new row violates row-level security policy for table
     "transaction_items"`.
   - `migrations/0004_shifts_delete.sql` — izin hapus shift untuk pemilik
     (restore/hapus data). Tanpa ini, DELETE shift menjadi no-op tanpa error
     sehingga shift lama muncul lagi setelah reload.
3. Alternatif CLI (butuh Docker):
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```

Migration lama (backup cloud / sync) sudah dihapus. Jangan mengubah migration
yang sudah diterapkan di project produksi; tambahkan file baru bernomor lanjut.

## 2. Aktifkan autentikasi (satu akun pemilik)

Aplikasi ini **satu outlet, satu akun pemilik**; tidak ada onboarding, pilihan
outlet, atau manajemen staf di UI.

1. **Authentication → Providers → Email**: aktifkan. Matikan "Confirm email"
   hanya bila Anda menerima risikonya (lebih aman biarkan aktif).
2. **Authentication → Users → Add user**: buat **satu** akun pemilik.
3. Masuk dari aplikasi. Pada login pertama, aplikasi memanggil RPC
   `create_outlet('Outlet utama')` secara otomatis yang:
   - membuat baris `outlets` bila akun belum punya,
   - mendaftarkan akun sebagai `staff.role = 'owner'`,
   - membuat `app_settings` awal.

Pemanggilan berikutnya mengembalikan outlet yang sama (idempoten), jadi tidak
ada risiko membuat outlet ganda karena klik/refresh berulang. Tabel `staff`
tetap ada untuk RLS, tetapi aplikasi tidak menampilkan pengelolaan staf.

## 3. Environment variable

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | ya | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | ya | anon/publishable key; aman di browser karena RLS |

Tidak ada env outlet: aplikasi selalu memakai outlet dari baris `staff`
akun yang login, sehingga tidak ada nilai build yang bisa menunjuk outlet lain.

Isi di Vercel → Project → Settings → Environment Variables (Production dan
Preview), lalu **redeploy** karena Vite menanamkan nilai saat build. Jangan pakai
`service_role` key di klien.

## 4. Bentuk data

| Tabel | Isi |
| --- | --- |
| `outlets` | identitas outlet |
| `staff` | pemetaan akun auth → outlet + peran (`owner`/`cashier`) |
| `app_settings` | preferensi aplikasi (JSON) + `next_transaction_number` |
| `menu_categories`, `ingredient_categories` | kategori menu/bahan |
| `menu_items` | menu, harga, foto (`image_url`), resep (JSON) |
| `ingredients` | bahan, satuan, harga beli, konversi, stok minimum |
| `stock_movements` | pembelian, penyesuaian, opname |
| `shifts` | buka/tutup shift |
| `transactions` | header transaksi + snapshot item (JSON) |
| `transaction_items` | baris item hasil trigger, untuk laporan SQL |
| `pos_documents` | `held_orders`, `pre_orders`, `cash_movements`, `expenses`, `audit_log` |

Gambar menu disimpan sebagai URL atau data URL di `menu_items.image_url`.
Untuk produksi jangka panjang, unggah ke Supabase Storage dan simpan URL-nya
(mengurangi ukuran baris database).

## 5. Aturan akses (RLS)

- Staf hanya melihat data outletnya (`is_outlet_member`).
- Master data (menu, bahan, kategori, pengaturan, outlet) hanya boleh ditulis
  pemilik (`is_outlet_owner`).
- Data operasional (transaksi, shift, stok, dokumen) boleh ditulis staf outlet;
  penghapusan transaksi hanya pemilik.
- `anon` tidak punya hak tabel; semua akses butuh sesi login.

### Akses ditolak (RLS)

Gejala: `Gagal menyimpan menu_categories: new row violates row-level security
policy`. Artinya akun yang login bukan `owner` outlet yang dipakai (mis. akun
dibuat ulang, atau baris `staff` menunjuk outlet lain). Periksa dan perbaiki di
SQL Editor:

```sql
-- 1) Periksa akun, peran, dan outlet
select u.email, s.role, s.outlet_id, o.name as outlet
from auth.users u
left join public.staff s on s.user_id = u.id
left join public.outlets o on o.id = s.outlet_id
order by u.email;

-- 2) Jadikan akun ini owner outlet yang benar (ganti nilai dalam <...>)
insert into public.staff (user_id, outlet_id, role, display_name, email)
select u.id, '<uuid-outlet>', 'owner', coalesce(u.email, 'Pemilik'), u.email
from auth.users u
where u.email = '<email-akun>'
on conflict (user_id) do update
  set outlet_id = excluded.outlet_id,
      role = excluded.role;
```

Bila pesan menyebut `transaction_items`, jalankan `0003_transaction_items_write.sql`;
bila menyebut `shifts` atau shift tidak ikut terhapus saat restore, jalankan
`0004_shifts_delete.sql`. Jangan mengulang `0001`/`0002`.

Muat ulang aplikasi setelah menjalankan SQL. Aplikasi tidak memakai env outlet,
jadi outlet yang dipakai selalu baris `staff` akun tersebut.

## 6. Konflik & konsistensi

- Client membaca snapshot outlet, lalu mengirim **hanya baris yang berubah**
  (upsert) dan menghapus baris yang hilang.
- Konflik antar perangkat diselesaikan *last-write-wins* lewat `updated_at`
  (trigger `touch_updated_at`) — tidak ada merge otomatis per field.
- Tidak ada antrean offline: bila jaringan gagal, penyimpanan ditolak dan UI
  menampilkan alert dengan tombol coba lagi. Data tetap ada di Supabase.
- Penulisan awal beberapa tabel tidak satu transaksi; mengulang simpan aman
  karena operasi berbasis id (idempotent).

## 7. Hasil uji pada PostgreSQL lokal

Migration diuji pada Postgres asli — **PostgreSQL 18.4 lokal** dan **PGlite/WASM**
lewat `bun run check:sql` — dengan stub Supabase (role `anon`, `authenticated`,
`service_role`, schema `auth` + `auth.uid()`/`auth.jwt()`). `bun run check:sql`
menjalankan semua file migration berurutan lalu menguji write path aplikasi
(75 pemeriksaan, 75 PASS / 0 FAIL saat rilis ini):

- `0001_init.sql` dan `0002_rls.sql` **apply bersih tanpa error** pada database
  kosong, dijalankan berurutan di **dua database baru** (masing-masing 12 tabel).
- RLS terbukti: pemilik outlet A bisa insert/update/select/delete master data
  outletnya; kasir outlet A bisa membaca master data, menulis transaksi, shift,
  stok, dan dokumen, tetapi tidak bisa menulis menu/pengaturan/staf; pengguna
  outlet B tidak melihat atau mengubah satu baris pun outlet A dan ditolak
  insert dengan `outlet_id` outlet A; `anon` ditolak dengan `42501`.
- `create_outlet()` mendaftarkan pemanggil sebagai `owner`, membuat
  `app_settings`, dan idempoten (panggilan kedua mengembalikan outlet yang sama).
- Trigger `transactions` mengisi `transaction_items` dan memperbaruinya saat item
  berubah. Fungsi trigger memakai `security definer` agar kasir tidak perlu
  policy tulis pada tabel item (bug ini ditemukan dan diperbaiki lewat uji SQL).

Migration **tidak idempoten** (memakai `create table` tanpa `if not exists`):
jalankan sekali pada project baru. Untuk mengulang, buat project/database baru.

## 8. Belum diuji di repo ini

- Ke project **Supabase hosted** belum dieksekusi (butuh kredensial project).
  Yang terbukti adalah apply + RLS pada Postgres asli (PGlite/PostgreSQL lokal)
  dengan stub Supabase, termasuk seluruh migration 0001–0004 lewat
  `bun run check:sql`. Login Supabase Auth dengan JWT asli dan PostgREST hosted
  tetap perlu diverifikasi sekali setelah project dibuat.
- Login Supabase Auth dengan JWT asli dan klien PostgREST belum diuji end-to-end;
  validasi data memakai gateway tiruan (`bun run check:repo`) dan SQL lokal.
- Realtime belum dipakai.
