# Supabase staging — Sabana POS Fase 1

Folder ini berisi migration dan alat seed untuk project **Supabase staging**. Aplikasi kasir **belum** terhubung ke Supabase; IndexedDB tetap sumber operasional dan checkout tidak menunggu jaringan.

## Status verifikasi

- `supabase/migrations/202610260001_init.sql` — DDL 22 tabel, diekstrak apa adanya dari `docs/superpowers/specs/2026-10-26-supabase-sync-design.md`.
- `supabase/migrations/202610260002_rls.sql` — helper + **33 policy** untuk seluruh tabel yang diberi grant `SELECT`; melengkapi contoh policy yang belum lengkap di dokumen desain.
- `supabase/migrations/202610260003_backup_storage.sql` — Fase 2: bucket privat `pos-backups` (limit 10 MB) + **4 policy Storage** (select/insert/update/delete) yang hanya mengizinkan `owner` menulis folder `pos-backups/<outlet_id>/...`.
- `supabase/migrations/202610260004_sync_changes.sql` — Fase 3: `row_version` + trigger pada tabel master, stream `public.outlet_changes`, RPC `pull_changes` dan `apply_sale`, RLS/hak akses untuk keduanya, serta keikutsertaan `outlet_changes` ke publikasi `supabase_realtime` (blok terjaga; dilewati di Postgres tanpa publikasi).
- `bun run check:db` menjalankan migration + seed + uji RLS + uji bucket/policy Storage + uji stream/RPC di **Postgres 18 (PGlite/WASM)** — **58 pemeriksaan**, termasuk seed yang dijalankan ulang setelah semua migration. Ini bukan project Supabase cloud.
- Hosted staging **sudah dibuat** di project `sabana-pos` (`egyaohgoyridudzoltxb`, region `ap-southeast-1`) dan migration 003 + 004 **sudah diterapkan** ke project tersebut. Laporan verifikasi ada di `supabase/hosted-report.json` (gitignored): **48/48 pemeriksaan lolos**, baik pada jalur apply (`bun run supabase:hosted`) maupun verify-only (`bun run supabase:verify`) — keduanya exit 0. Sembilan di antaranya memanggil `pull_changes`/`apply_sale` sungguhan di database hosted di dalam satu transaksi yang diakhiri `rollback`, jadi tidak ada baris uji yang tertinggal. Tidak ada kredensial yang ditulis ke repo.
- **Production terpisah sudah dibuat dan diverifikasi (2026-10-28 09:37 UTC):** project `sabana-pos-production` (`lwirpcrggtsxcooqlriz`), migration 001–004, owner, seed **master data saja**, dan rehearsal backup/restore terenkripsi — **39/39 pemeriksaan lolos**, exit 0. Staging tidak disentuh. Rincian dan langkah lanjutan ada di [Production terpisah](#production-terpisah--sabana-pos-production).

## Production terpisah — `sabana-pos-production`

Production dibuat sebagai project **baru**, bukan hasil menyalin database staging. Transaksi, shift, kas, stok, beban, pre-order, jurnal, audit, dan snapshot staging **tidak** ikut; yang dipindahkan hanya master data katalog dan akun.

| Environment | Project | Ref | Region | Verifikasi |
|---|---|---|---|---|
| Staging | `sabana-pos` | `egyaohgoyridudzoltxb` | `ap-southeast-1` | 48/48 (2026-10-27) |
| **Production** | **`sabana-pos-production`** | **`lwirpcrggtsxcooqlriz`** | **`ap-southeast-1`** | **39/39 (2026-10-28 09:37 UTC)** |

API URL production: `https://lwirpcrggtsxcooqlriz.supabase.co` • Dashboard: `https://supabase.com/dashboard/project/lwirpcrggtsxcooqlriz` • Outlet: `cbddce27-79ad-4d1c-9964-9364c806161a`.

State dan laporan bersifat lokal/gitignored: `supabase/production.json`, `supabase/production-report.json`, dan `supabase/production/*.sql`. Tidak ada token, password, service role key, atau frasa sandi yang ditulis ke sana.

### Urutan migration (wajib berurutan)

Wizard `bun run supabase:production` membaca `supabase/migrations` terurut dan menyimpan progres **per file** agar bisa dilanjutkan bila provisioning terputus. Jangan menjalankan ulang 001 secara manual pada database yang sudah berisi schema.

| # | File | Isi |
|---|---|---|
| 1 | `202610260001_init.sql` | 22 tabel, chart of accounts, grant minimum; `anon` dicabut |
| 2 | `202610260002_rls.sql` | helper membership + 33 policy RLS (total 34 setelah policy stream di 004) |
| 3 | `202610260003_backup_storage.sql` | bucket privat `pos-backups` + 4 policy Storage |
| 4 | `202610260004_sync_changes.sql` | `row_version`, `outlet_changes`, `pull_changes`, `apply_sale`, publikasi realtime |

### Owner

- Email: `ridhoshaumil@gmail.com` • user id: `07340dae-dda0-432b-8b2f-d6355f4a7a3c`.
- Dibuat lewat Supabase Auth Admin dengan `email_confirm: true` dan password acak yang **tidak disimpan atau ditampilkan**. Membership `outlet_members` role `owner` dibuat oleh seed.
- **Langkah Anda:** reset password di **Dashboard → Authentication → Users → Reset password**, lalu pakai password itu saat mengisi panel Backup cloud di aplikasi. Tidak ada email reset yang dikirim otomatis oleh wizard.
- Rehearsal memakai **magic link admin**, bukan password, sehingga bisa menguji sesi owner tanpa mengetahui password.

### Seed master data

`buildMasterSeedArtifacts()` hanya menulis tabel master. Hasil production:

| Tabel | Baris |
|---|---:|
| `outlets` | 1 |
| `outlet_settings` | 1 |
| `outlet_counters` | 1 (nomor berikutnya **1**, jadi struk pertama `POS-1`) |
| `accounts` | 13 |
| `categories` | 5 |
| `ingredients` | 23 |
| `menus` | 11 |
| `menu_recipes` | 69 |

Tabel operasional diverifikasi **0 baris**: `shifts`, `transactions`, `transaction_items`, `cash_movements`, `stock_movements`, `expenses`, `preorders`, `preorder_items`, `journal_entries`, `journal_lines`, `audit_log`, `outlet_snapshots`. Identitas awal `Sabana POS`, kertas 80 mm, 1 salinan, skema 8. Katalog yang di-seed berasal dari fixture staging, jadi masih **contoh**; ganti lewat mode pemilik, bukan dengan men-seed ulang.

Jangan menjalankan `bun run db:seed` (seed staging penuh) ke production: perintah itu memasukkan transaksi/shift/jurnal dan `verify.sql` staging akan menolak karena angka kontrolnya berbeda. Gunakan `bun run supabase:production` yang memakai generator master-only.

### Rehearsal backup/restore

Dijalankan pada project production dengan sesi owner sungguhan (magic link) dan fungsi klien yang sama dengan aplikasi:

| Langkah | Bukti |
|---|---|
| Login owner | magic link berhasil, `userId=07340dae-…` |
| Unggah | envelope terenkripsi **24.060 byte**, checksum `52e0020be5e4` |
| Metadata | 1 baris `outlet_snapshots`, terlihat oleh owner |
| Unduh + dekripsi | **17.663 karakter**, checksum cocok |
| Validasi restore | `inspectBackup()` lolos: 11 menu, 23 bahan |
| Anon | unduhan langsung ditolak **HTTP 400** |
| Pembersihan | objek HTTP 200, metadata HTTP 204, `storage.objects` **0**, `outlet_snapshots` **0**, GET cache **400** |

**Batas jujur:** rehearsal ini memakai jalur service/kode klien (`uploadSnapshot` → `listCloudSnapshots` → `downloadCloudSnapshot` → `inspectBackup`) dengan sesi owner asli, **bukan** klik-klik UI Backup di browser. Restore lewat UI dan backup harian terjadwal belum diuji terhadap production. Uji itu membutuhkan password owner yang sudah direset dan konfigurasi panel Backup cloud di aplikasi.

### Konfigurasi aplikasi setelah setup

1. Reset password owner seperti di atas.
2. Buka aplikasi → **Backup → Backup cloud**. Isi: project URL `https://lwirpcrggtsxcooqlriz.supabase.co`, **anon/publishable key** (bukan secret/service role), outlet id `cbddce27-79ad-4d1c-9964-9364c806161a`, email owner + password baru, dan frasa sandi enkripsi (min. 8 karakter).
3. Klik **Backup sekarang ke cloud** lalu cek snapshot muncul; unduh/restore sekali untuk membuktikan alur UI.
4. Ganti katalog contoh dan identitas toko lewat mode pemilik. Data operasional tetap IndexedDB per perangkat; tablet kedua tidak otomatis berbagi transaksi.

### Perintah

```bash
bun run supabase:production          # buat/lanjutkan project, migration, owner, seed master, cek, rehearsal
bun run supabase:production:verify   # hanya cek 39 pemeriksaan + rehearsal pada project yang tercatat
```

Token diminta lewat input tersembunyi bila `SUPABASE_ACCESS_TOKEN` belum ada. Override opsional: `SUPABASE_PRODUCTION_PROJECT_NAME`, `SUPABASE_PRODUCTION_REGION`, `SUPABASE_PRODUCTION_OWNER_EMAIL`, `SUPABASE_PRODUCTION_BUSINESS_NAME`, `SUPABASE_PRODUCTION_OUTLET_NAME`, `SUPABASE_PRODUCTION_REF`, `SUPABASE_ORG_ID`.

**Plan Free:** akun ini sekarang memakai dua project aktif (staging + production). Project ketiga memerlukan pause/hapus salah satu atau upgrade. Production free plan tidak menyediakan PITR; salinan yang diuji adalah snapshot terenkripsi level aplikasi di bucket privat.

## Jalur hosted (staging, setelah kredensial tersedia)

1. Buat project Supabase baru di dashboard, region **Southeast Asia (Singapore)**, simpan password database.
2. Buat user pemilik di **Authentication → Users** (email + password), lalu salin UUID user tersebut.
3. Tambahkan secret berikut di **Freebuff → Settings → Secrets** (jangan pernah menempelkan token di chat):
   - `SUPABASE_ACCESS_TOKEN` — Personal Access Token Supabase.
   - `SUPABASE_DB_URL` — connection string Postgres project staging.
   - `SUPABASE_DB_PASSWORD` — password database (dipakai CLI saat link/push).
4. Hubungkan dan jalankan migration (jalankan `bunx supabase init` sekali bila `supabase/config.toml` belum ada; folder `migrations/` tidak akan ditimpa):

```bash
bunx supabase init
bunx supabase link --project-ref <project-ref>
bunx supabase db push
```

5. Buat seed dari backup/staging lokal:

```bash
bun run sync:export --input <backup.json> --out staging/supabase
bun run db:seed \
  --outlet-id <uuid-outlet-baru> \
  --owner-user-id <uuid-auth-user> \
  --staging staging/supabase \
  --out supabase/seed
```

`db:seed` memverifikasi SHA-256 dan jumlah baris staging, lalu menulis `supabase/seed/seed.sql` + `verify.sql` (keduanya diabaikan Git karena memuat data bisnis).

6. Terapkan seed lewat **SQL Editor** dashboard, atau:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/seed.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/verify.sql
```

7. Uji RLS di dashboard: login sebagai owner, kasir, dan user outlet lain; pastikan kasir tidak bisa menulis katalog dan tidak melihat stok/jurnal/audit.

## Fase 2 — bucket backup terenkripsi

`202610260003_backup_storage.sql` membuat bucket **privat** `pos-backups` dan policy pada `storage.objects`:

| Policy | Aksi | Aturan |
|---|---|---|
| `pos_backups_owner_read` | SELECT | `bucket_id = 'pos-backups'` dan `is_outlet_owner(folder pertama path)` |
| `pos_backups_owner_insert` | INSERT | sama, lewat `with check` |
| `pos_backups_owner_update` | UPDATE | sama |
| `pos_backups_owner_delete` | DELETE | sama |

Folder pertama path wajib UUID outlet (`public.snapshot_outlet_from_path()`); path lain menghasilkan `null` sehingga ditolak. Kasir (role member non-owner) dan anon tidak punya akses.

Aplikasi mengunggah **envelope terenkripsi** (`sabana-pos-cloud-backup`, AES-GCM 256, kunci PBKDF2 dari frasa sandi) dan menulis metadata ke `public.outlet_snapshots`. Isi backup tidak pernah dikirim sebagai plaintext.

Menerapkan ke project hosted:

```bash
bunx supabase link --project-ref <project-ref>
bunx supabase db push   # menjalankan 001, 002, 003 berurutan
```

Setelah migration, buat user pemilik di **Authentication → Users**, lalu aktifkan dari aplikasi pada **Backup → Backup cloud** (URL project, anon key, UUID outlet, email + kata sandi pemilik, frasa sandi enkripsi).

Verifikasi lokal tanpa cloud:

```bash
bun run check:db     # termasuk bucket privat + policy Storage
bun run check:cloud  # 66 pemeriksaan mock: enkripsi, auth, upload, metadata, restore
```

Wizard `bun run supabase:hosted`/`supabase:verify` kini juga memeriksa bucket ini. Pada project yang tabelnya sudah ada, wizard menjalankan migration 003 bila bucket/policy belum terdeteksi — dan sudah dilakukan pada project staging; mode `--verify-only` tetap tidak mengubah apa pun. Laporan hosted terakhir (**48/48**) sudah memuat pemeriksaan bucket, stream sinkronisasi, dan pemanggilan RPC-nya.

**Belum diuji ke project hosted pada turn ini** (tidak ada kredensial): unggahan nyata, riwayat tujuh snapshot harian, dan restore cloud di browser bersih.

## Fase 3 — stream perubahan + RPC sinkronisasi

`202610260004_sync_changes.sql` menambahkan:

| Objek | Fungsi |
|---|---|
| `row_version` + trigger `bump_row_version` | Versi baris monoton pada `categories`, `menus`, `ingredients`, `outlet_settings`, `menu_recipes` (kolom `updated_at` ditambahkan untuk `menu_recipes`). Kolom `revision` warisan 001 tetap dinaikkan `touch_row`; versi otoritatif sinkronisasi adalah `row_version` |
| `public.outlet_changes` | Stream perubahan per outlet: `seq` identity (monoton), `entity`, `entity_id`, `op` (`upsert`/`delete`), `row_version`, `payload`, `changed_at`; index `(outlet_id, seq)` |
| `pull_changes(p_outlet, p_since_seq, p_limit)` | Satu halaman perubahan + `next_seq` + `has_more` (maks. 500 baris), menolak non-member |
| `apply_sale(p_payload)` | Terapkan transaksi + item atomik; idempoten per ID, validasi subtotal, tolak outlet lain |
| Publikasi `supabase_realtime` | `outlet_changes` diikutkan agar `postgres_changes` terkirim; blok `do $$` melewati dirinya sendiri bila publikasi tidak ada (PGlite/CI) |

```sql
-- contoh pemakaian (sebagai user yang login)
select public.pull_changes('<outlet-uuid>'::uuid, 0, 200);
select public.apply_sale('{"outlet_id":"<outlet-uuid>","device_id":"kasir-1","transaction":{"id":"tx-1","number":"POS-1","order_type":"Takeaway","payment_method":"Cash","subtotal":25000,"paid_amount":30000,"change_amount":5000,"status":"completed","shift_id":"shift-1"},"items":[{"id":"tx-1-item-1","name":"Ayam","category":"Paket","price":25000,"qty":1}]}'::jsonb);
```

Hak akses: `outlet_changes` hanya `SELECT` untuk member outlet (tanpa grant tulis ke klien); `pull_changes`/`apply_sale` adalah `security definer` dengan cek membership, `EXECUTE` hanya untuk `authenticated` (anon ditolak). Trigger penulis stream berjalan sebagai pemilik tabel, bukan sebagai klien.

Aplikasi memakainya lewat `src/lib/sync-client.ts`: pull berpaginasi dengan kursor `sync:state`, realtime sebagai pemicu + polling 60 detik, dan antrean penjualan `sync:outbox` yang dikirim via `apply_sale`.

Verifikasi lokal:

```bash
bun run check:db     # trigger, seq, paginasi, RLS, idempotensi apply_sale
bun run check:pull   # mock fetch + websocket: paginasi, tombstone, LWW, fallback polling
```

**Hosted (2026-10-27 11:52):** migration 004 (dan 003) sudah diterapkan ke project `sabana-pos` — wizard menjalankannya otomatis karena stream/bucket belum terdeteksi. Jalur **apply** (`bun run supabase:hosted`, exit 0: `✔ Seed diterapkan`, `✔ verify.sql lolos`) dan **verify-only** (`bun run supabase:verify`, exit 0) keduanya mencatat **48/48 lolos**, termasuk `Stream sinkronisasi: outlet_changes + pull_changes + apply_sale + publikasi realtime siap`.

Sembilan pemeriksaan tambahan memanggil RPC di database hosted (bukan lewat browser): `pull_changes` memberi 2 baris + `has_more=true` lalu 1 baris tombstone `op=delete` dengan `seq` berurutan, `apply_sale` menerapkan lalu mengembalikan `duplicate:true` tanpa menggandakan baris, dan pull lintas-outlet maupun anon ditolak `42501`. Semuanya dijalankan sebagai peran `authenticated` di dalam transaksi yang diakhiri `rollback`; probe lalu memverifikasi 0 baris sisa.

**Belum diuji**: jalur klien `sync-client.ts` di browser dengan sesi pemilik Fase 2, handshake Realtime sungguhan, serta sinkronisasi dua perangkat.

**Regresi seed:** langkah seed pada run apply sempat gagal karena `jsonb_populate_recordset(null::tabel, ...)` + `select *` mengisi kolom NOT NULL baru (`row_version`, `updated_at` pada `menu_recipes`) dengan NULL alih-alih DEFAULT. Setelah generator seed menulis daftar kolom eksplisit dari staging, langkah yang sama **lulus di project hosted** (run apply di atas), dan `check:db` menjalankan ulang seed setelah semua migration untuk mengunci perilaku ini.

## Verifikasi ulang tanpa seed

Gunakan mode verifikasi saja bila hanya ingin mengulang 48 pemeriksaan hosted pada project yang sudah ada:

```bash
bun run supabase:verify
```

- Membaca project dari `supabase/hosted.json` atau `SUPABASE_PROJECT_REF` (opsional: `SUPABASE_OUTLET_ID`, `SUPABASE_OWNER_USER_ID`, `SUPABASE_OWNER_EMAIL`).
- Owner diambil dari `hosted.json`; bila belum ada, dari `outlet_members` dengan role `owner`. Email owner hanya informatif untuk laporan.
- **Tidak** membuat project, **tidak** menjalankan DDL/migration, dan **tidak** men-seed ulang.
- Tetap meminta PAT lewat input tersembunyi bila `SUPABASE_ACCESS_TOKEN` belum ada.
- Menulis ulang `supabase/hosted-report.json`; `supabase/hosted.json` tidak diubah.
- Probe RPC (`pull_changes`, `apply_sale`, penolakan lintas-outlet/anon) berjalan di dalam `begin; … rollback;` sehingga tidak membuat, mengubah, atau menghapus data project.
- Bisa juga dipanggil langsung: `bash scripts/supabase-hosted.sh --verify-only` atau `SUPABASE_VERIFY_ONLY=1 bun run scripts/supabase-hosted.ts`.

## Yang disengaja lokal / belum termasuk

- `theme`, `printer.deviceName`, `printer.autoPrint`, dan **`ownerPin` tidak dikirim ke Supabase**.
- `heldOrders` tidak diekspor.
- RPC (`record_sale`, `open_shift`, `post_journal`, dll.) belum dibuat; itu Fase 3. Karena itu aplikasi belum menulis ke Supabase.
- Tabel `outlet_counters` dan `sync_mutations` hanya untuk service role/RPC; tidak ada grant ke `authenticated`.
- Katalog memakai soft delete (`deleted_at`) dan grant `UPDATE`, bukan `DELETE`.
- Seed tidak melakukan `TRUNCATE`; semua insert `on conflict do nothing`, aman dijalankan ulang pada database staging kosong/seed yang sama.

## Uji lokal

```bash
bun run check:db
```

Uji ini memakai `supabase/local/prelude.sql` (stub `auth.uid()` dan role Supabase) yang **tidak boleh** dijalankan di project Supabase. Fixture RLS ada di `supabase/tests/`.
