# FnB POS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver an Android-first FnB POS foundation that supports fast cashier transactions and can grow into offline sync, inventory, forecasting, and accounting.

**Architecture:** Preserve the existing React + Vite frontend for the first slice, using typed domain state and responsive components. Add Capacitor, local SQLite/sync, backend, native Bluetooth, and accounting modules in separate validated stages rather than coupling them to the initial UI prototype.

**Tech Stack:** React 19, TypeScript, Vite, existing CSS/design system; later Capacitor Android, SQLite, sync API, Google Sheets API, and native Bluetooth plugin.

**Spec:** `docs/superpowers/specs/2026-10-26-fnb-pos-design.md`

## Status implementasi (26 Oktober 2026)

- **Selesai:** Task 1 (POS), Task 2 (domain + helper), Task 4 sebagian (persistence lokal, ID idempotent, indikator online/offline), Task 5 (katalog/resep/HPP, inventory, forecast harian & mingguan, jurnal double-entry, PNL, neraca saldo, neraca, buku besar), Task 6 sebagian (struk + cetak, backup/restore JSON, ekspor CSV, audit log).
- **Selesai pada increment ini:** CRUD menu (foto, resep, status, harga), CRUD bahan dengan tombol hapus di tabel, opname stok (tambah/edit/hapus dengan snapshot stok sistem dan biaya satuan, serta jurnal penyesuaian persediaan otomatis), pembelian massal (mode per satuan/per pack dengan konversi & biaya otomatis), tab kategori (tambah/rename/urut/hapus dengan proteksi), foto menu tanpa crop di kasir & pemilik, tab pengaturan aplikasi (identitas outlet, footer struk, tema, printer 58/80 mm, auto-print, tata letak struk, pairing, tes cetak), abstraksi transport printer native/Web Bluetooth/dialog, dan poles navigasi mode pemilik.
- **Selesai pada increment keamanan data:** penyimpanan utama IndexedDB dengan wrapper JSON per key, migrasi satu kali dari localStorage tanpa menghapus data lama, error tulis/kuota terlihat di UI, backup JSON harian (dicek saat dibuka dan berkala) + sebelum tutup shift yang disimpan sebagai backup terakhir, validasi + pratinjau + konfirmasi restore, dan PIN pemilik ter-hash SHA-256 + salt dengan kode pemulihan sekali tampil. PIN menjaga mode pemilik, pengaturan/printer, void, ubah menu/harga, dan tutup shift; kasir tetap bisa berjualan tanpa PIN.
- **Belum:** Task 3 (Capacitor Android/PWA installable dengan service worker), backend sync + outbox idempotent, Google Sheets live, implementasi bridge native `window.SabanaPrinter` untuk Bluetooth Classic/SPP. Build saat ini murni web; Web Bluetooth BLE tersedia di Chrome/Edge.
- **Verifikasi:** `bun run typecheck`, `bun run build`, `bun run check:domain` (145 pemeriksaan, termasuk migrasi state lama, no-NaN cash, idempotensi tanpa duplikasi kas/jurnal, validasi backup rusak/versi lebih baru, hash PIN & kode pemulihan, kategori & pengaturan, gambar menu, snapshot opname, jurnal opname debit/kredit serta pengaruh PNL & neraca, tata letak struk, pemilihan transport native/Web Bluetooth/sistem, payload ESC/POS bersama, fallback dialog, serta periode/metrik/komposisi/tren ringkasan), `bun run check:storage` (14 pemeriksaan fake-indexeddb: migrasi, idempotensi, backup harian/tutup shift, unduhan JSON, gagal tulis), `bun run check:runtime` (121 pemeriksaan jsdom: mount App, PIN wajib + reset pemulihan, PIN untuk tutup shift dan void transaksi, alert gagal simpan, restore file rusak/valid + pratinjau, filter periode ringkasan + grafik dan donut dinamis, CRUD menu/bahan/kategori, pembelian massal per pack, opname tambah/edit/hapus dengan biaya snapshot, baris selisih persediaan di laporan, pengaturan outlet/printer/tata letak struk, panel transport + diagnostik saat tanpa bridge, propagasi ke POS).

## Skema dan migrasi data

- `SCHEMA_VERSION = 6` disimpan di `schemaVersion` dan key `sabana-pos-schema-version`.
- `src/lib/storage.ts` menyimpan JSON per key di IndexedDB (`sabana-pos` → `kv`). `src/lib/persistence.ts` memuat/menyimpan state utama dan fallback localStorage hanya untuk runtime lama/WebView.
- Migrasi localStorage → IndexedDB berjalan bila key `pos-store` belum ada; data lama tidak dihapus dan migrasi ditandai `meta:legacy-migration`. Migrasi kedua tidak menimpa data IndexedDB.
- `src/lib/schema.ts` → `normalizeStore()` dipanggil pada load, save, export, dan restore backup.
- Idempoten: normalisasi berulang menghasilkan JSON yang sama, tanpa menambah transaksi/kas/jurnal.
- Seed katalog & bahan hanya dipakai bila daftar kosong; harga/resep/status/kategori milik pengguna dipertahankan.
- Skema v3 menambahkan `categories`, `settings` (identitas outlet/struk, tema, printer), dan `menu.imageUrl`; state lama mendapat default aman.
- Skema v4 menambahkan `unitCost` pada opname sebagai snapshot biaya dan jurnal penyesuaian ke akun 1200/6100; opname lama diisi biaya bahan saat migrasi lalu dibekukan.
- Skema v5 menambahkan tata letak struk (`headerAlign`, `footerAlign`, `fontSize`, `showOrderType`, `showPaymentDetail`, `copies`); state lama mendapat default aman.
- Skema v6 menambahkan `settings.ownerPin` (hash SHA-256 + salt, plus hash kode pemulihan). PIN tidak pernah disimpan sebagai plaintext.
- Backup JSON memakai wrapper `sabana-pos-backup` dengan `formatVersion`, `schemaVersion`, `createdAt`, `reason`, ringkasan, dan state lengkap. Backup harian dan sebelum tutup shift disimpan sebagai `backup:latest` di IndexedDB. Restore memvalidasi struktur/versi dan meminta konfirmasi; file rusak tidak mengubah state.
- Kegagalan tulis/kuota ditampilkan sebagai alert dengan tombol coba lagi; jalur simpan tidak memakai catch kosong.
- Printer: `src/lib/printer-connection.ts` memilih native `window.SabanaPrinter` → Web Bluetooth BLE → dialog sistem. `src/lib/escpos.ts` membentuk payload inisialisasi/teks/umpan/potong satu kali; native menerima payload base64, Web Bluetooth menulis byte yang sama, dan Classic/SPP tetap memerlukan bridge native.
- Normalisasi field legacy: `paidAmount`/`change` dari subtotal, `dp` pre-order, `openingFloat` shift, `nextTransactionNumber` dari nomor tertinggi, ID fallback berbasis indeks.
- Foto menu disimpan sebagai data URL terkompresi (maks. 560 px JPEG); tampilan memakai `object-fit: contain` agar tidak terpotong.

## Global Constraints

- Android tablet and mobile are the first target.
- Takeaway is the default order type.
- Cashier float defaults to Rp350,000.
- Dine in has no table selection.
- Cash in/out requires amount plus free-form note and no category.
- Pre-order stock and sale recognition occur when processing begins.
- QRIS is manually confirmed in the first version.
- Google Sheets is a reporting clone, not the source of truth.
- Posted accounting journals are corrected, never deleted.

## Review Focus

- Empty cart and checkout validation: checkout must remain unavailable until an item exists.
- Offline/sync state: UI must clearly distinguish offline, pending, syncing, and synced.
- Cash reconciliation: QRIS must not inflate expected physical cash.
- Pre-order lifecycle: DP receipt must not reduce stock before “Mulai Diproses”.
- Responsive touch targets: primary cashier actions must remain usable on narrow mobile screens.

---

### Task 1: Responsive POS foundation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: relevant existing components/sections as needed

**Interfaces:**
- Produces a cashier-facing POS screen with typed local state and callbacks for cart, order type, held orders, pre-orders, checkout, and shift summary.

- [ ] Add demo menu categories/items from the approved HPP references, with prices and category filters.
- [ ] Add cart quantity controls, subtotal/total, order type selector, and payment modal.
- [ ] Add topbar sync indicator and shift status.
- [ ] Add held-order and pre-order panels with the approved status rules.
- [ ] Add owner/cashier navigation affordance without implementing backend authorization.
- [ ] Verify narrow mobile and tablet layouts through the dev preview.

### Task 2: Local domain contracts

**Files:**
- Create: `src/domain/pos.ts`
- Create: `src/domain/accounting.ts`
- Test: focused domain tests

- [ ] Define stable types for orders, payments, shifts, cash movements, pre-orders, inventory movements, and journal entries.
- [ ] Implement pure helpers for expected cash, order totals, and pre-order recognition.
- [ ] Test cash/QRIS and pre-order edge cases.

### Task 3: Capacitor Android shell

**Files:**
- Modify: `package.json`
- Create: Capacitor config and Android project

- [ ] Add Capacitor only after the web slice is accepted.
- [ ] Configure Android app identity and web asset output.
- [ ] Verify Android build prerequisites and document unavailable native checks.

### Task 4: Offline persistence and sync

**Rancangan skema & migrasi cloud:** `docs/superpowers/specs/2026-10-26-supabase-sync-design.md` (Supabase, local-first, bertahap; belum diterapkan).

**Files:**
- Create: local storage/SQLite adapter
- Create: sync queue and idempotency contracts
- Modify: topbar sync state integration

- [ ] Persist operational records locally.
- [ ] Queue mutations with stable IDs and retry safely.
- [ ] Add backend sync boundary and conflict states.
- [ ] Verify interrupted sync does not duplicate transactions.

### Task 5: Inventory, forecast, and accounting

**Files:**
- Create: recipe/inventory domain modules
- Create: forecast helpers
- Create: journal posting and reporting modules

- [ ] Add editable recipes, units, purchase units, stock movements, and minimum stock.
- [ ] Calculate daily and weekly ingredient requirements from sales history.
- [ ] Post automatic double-entry journals for sales, HPP, payments, purchasing, expenses, DP, and cash transfers.
- [ ] Produce PNL, ledger, trial balance, balance sheet, and cash flow.

### Task 6: Integrations and operational hardening

**Files:**
- Create: Bluetooth printer adapter
- Create: Google Sheets reporting adapter
- Create: backup/restore and audit log modules

- [ ] Queue receipt printing without blocking transaction completion.
- [ ] Clone normalized reporting tabs to Google Sheets with idempotent row keys.
- [ ] Add backup/restore and immutable audit trail.
