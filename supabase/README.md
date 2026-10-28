# Supabase — Sabana POS (online-only)

Aplikasi memakai Supabase sebagai **sumber kebenaran**. Tanpa env Supabase, app
berjalan mode lokal untuk pengembangan; build produksi wajib memakai env.

## 1. Buat project & jalankan migration

1. Buat project di <https://supabase.com/dashboard> (region terdekat).
2. Buka **SQL Editor**, jalankan berurutan:
   - `migrations/0001_init.sql` — tabel, index, trigger, RPC onboarding.
   - `migrations/0002_rls.sql` — RLS per outlet + hak akses.
3. Alternatif CLI (butuh Docker):
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```

Migration lama (backup cloud / sync) sudah dihapus. Jangan mengubah migration
yang sudah diterapkan di project produksi; tambahkan file baru bernomor lanjut.

## 2. Aktifkan autentikasi

1. **Authentication → Providers → Email**: aktifkan, matikan "Confirm email"
   hanya bila Anda menerima risiko (lebih aman biarkan aktif).
2. **Authentication → Users → Add user**: buat akun pemilik (email + password).
3. Masuk dari aplikasi. Akun baru tanpa outlet akan melihat layar
   **Buat outlet pertama**; tombol itu memanggil RPC `create_outlet(nama)` yang:
   - membuat baris `outlets`,
   - mendaftarkan akun sebagai `staff.role = 'owner'`,
   - membuat `app_settings` awal.

Bila ingin onboarding manual lewat SQL:

```sql
select public.create_outlet('Outlet utama');
```

Menambah kasir (setelah punya akun):

```sql
insert into public.staff (user_id, outlet_id, role, display_name, email)
values ('<uuid auth.users>', '<uuid outlet>', 'cashier', 'Kasir 1', 'kasir@contoh.com');
```

## 3. Environment variable

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | ya | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | ya | anon/publishable key; aman di browser karena RLS |
| `VITE_OUTLET_ID` | tidak | kosong = outlet diambil dari baris `staff` akun |

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

## 6. Konflik & konsistensi

- Client membaca snapshot outlet, lalu mengirim **hanya baris yang berubah**
  (upsert) dan menghapus baris yang hilang.
- Konflik antar perangkat diselesaikan *last-write-wins* lewat `updated_at`
  (trigger `touch_updated_at`) — tidak ada merge otomatis per field.
- Tidak ada antrean offline: bila jaringan gagal, penyimpanan ditolak dan UI
  menampilkan alert dengan tombol coba lagi. Data tetap ada di Supabase.
- Penulisan awal beberapa tabel tidak satu transaksi; mengulang simpan aman
  karena operasi berbasis id (idempotent).

## 7. Belum diuji di repo ini

- Migration belum dieksekusi ke project Supabase nyata pada turn ini (butuh
  kredensial project). Validasi dilakukan lewat review SQL + uji repo dengan
  gateway tiruan (`bun run check:repo`).
- Alur login, RLS, dan realtime belum diuji end-to-end tanpa project nyata.
