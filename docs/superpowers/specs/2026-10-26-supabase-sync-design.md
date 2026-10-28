# Supabase Schema & Phased Migration — Sabana POS

**Status:** design only. Belum ada project Supabase, migration yang dijalankan, atau perubahan kode aplikasi.
**Tujuan:** menambah penyimpanan cloud dan sinkronisasi multi-perangkat tanpa mengubah alur kasir yang sudah ada.
**Basis data lokal:** IndexedDB `sabana-pos` → `kv` → `pos-store`, schema v6.
**Basis data cloud:** Supabase Postgres, region Singapura.

---

## 1. Prinsip yang tidak boleh dilanggar

1. **IndexedDB tetap menjadi sumber data operasional kasir.** Kasir harus bisa membuka shift, menjual, mencetak, dan menutup shift tanpa internet.
2. **Tidak ada `await` jaringan di alur checkout, cetak, atau tutup shift.** Semua penulisan cloud terjadi setelah state lokal tersimpan.
3. **Tidak ada perubahan layar atau langkah kasir.** Sinkronisasi berjalan di belakang layar; indikator memakai ikon cloud yang sudah ada di topbar.
4. **Transaksi, kas, stok, dan jurnal bersifat append-only.** Koreksi memakai void/refund/reversal, bukan edit atau hapus.
5. **PIN pemilik tetap lokal dan tidak disinkronkan.** PIN adalah kunci UI, bukan autentikasi cloud. Supabase memakai Supabase Auth.
6. **Uang memakai `numeric`, bukan float.** Konversi dilakukan di boundary API.
7. **Service role key tidak pernah masuk ke bundle Vite.** Hanya `SUPABASE_URL` dan `SUPABASE_ANON_KEY` yang boleh ada di klien; RLS yang melindungi data.

---

## 2. Arsitektur target

```text
Kasir / Pemilik (React)
        │
        ▼
state PosStore di memori
        │  tulis lokal dulu (sinkron)
        ▼
IndexedDB: pos-store + sync-outbox
        │  push di latar belakang (tidak memblokir UI)
        ▼
Supabase RPC (validasi + idempotensi)
        │
        ├── Postgres: transaksi, katalog, shift, stok, jurnal
        ├── Realtime: katalog/pengaturan/pesanan
        └── Storage: foto menu + snapshot backup terenkripsi
```

### Peran masing-masing lapisan

| Lapisan | Peran |
|---|---|
| IndexedDB | Cache panas, antrean offline, sumber kebenaran sesaat untuk kasir |
| Outbox lokal | Daftar mutasi yang belum diterima server, dengan `client_seq` |
| Supabase Postgres | Catatan durable bersama, laporan, audit, dan rekonsiliasi |
| Supabase RPC | Validasi bisnis, idempotensi, penomoran, posting jurnal |
| Supabase Realtime | Perubahan katalog/pengaturan/pesanan antarperangkat |
| Supabase Storage | Foto menu dan snapshot backup terenkripsi |

---

## 3. Konvensi skema

- **ID entitas:** `text`, mempertahankan ID lama (`dada`, `ayam-dada`, `paket`) agar referensi resep/transaksi tidak berubah. ID baru memakai UUID string dari `crypto.randomUUID()`.
- **Outlet:** `uuid`; satu outlet untuk fase awal, tetapi semua tabel membawa `outlet_id`.
- **Uang:** `numeric(14,2)` untuk nominal; `numeric(14,4)` untuk biaya per satuan.
- **Jumlah stok:** `numeric(14,3)`.
- **Waktu:** `timestamptz`; `created_at` adalah waktu bisnis dari perangkat, `created_at_server` adalah waktu penerimaan server.
- **Soft delete:** `deleted_at` untuk katalog. Tabel ledger tidak memiliki delete.
- **Konkurensi:** `revision bigint` pada tabel yang dapat diedit; klien mengirim `base_revision`.
- **Device:** `device_id text` pada record operasional untuk audit dan idempotensi.
- **Snapshot:** nama, harga, kategori, dan gambar item disalin ke transaksi agar struk lama tidak berubah saat menu/harga berubah. COGS saat ini dihitung ulang dari resep oleh `accounting.ts`; belum ada snapshot COGS di kode, jadi belum ada kolom COGS di skema.
- **Akun:** chart of accounts disimpan di tabel `accounts`; kode akun tidak berubah.

---

## 4. Cakupan model data: `PosStore` → Supabase

| `PosStore` | Tabel Supabase | Catatan |
|---|---|---|
| `categories[]` | `categories` | Nama unik per outlet; `sort_order` dari urutan array |
| `menus[]` | `menus` + `menu_recipes` | `menu.category` (nama) dipetakan ke `category_id` |
| `ingredients[]` | `ingredients` | `costPerUnit` → `cost_per_unit` |
| `transactions[]` | `transactions` + `transaction_items` | Item menyimpan snapshot nama/harga/kategori/gambar |
| `cashMovements[]` | `cash_movements` | Terhubung ke shift |
| `shifts[]` | `shifts` | Satu shift `open` per outlet |
| `heldOrders[]` | **lokal saja** | Keranjang belum dibayar; tidak disinkronkan |
| `preOrders[]` | `preorders` + `preorder_items` | Status mengikuti state machine |
| `stockMovements[]` | `stock_movements` | Termasuk `unit_cost`, `counted_qty`, `system_qty` untuk opname |
| `expenses[]` | `expenses` | Beban operasional |
| `auditLog[]` | `audit_log` | Append-only; aktor lama boleh `null` |
| `settings` | `outlet_settings` + lokal | Identitas/struk masuk cloud; `theme`, `printer.deviceName`, `printer.autoPrint`, dan `ownerPin` tetap lokal per perangkat |
| `nextTransactionNumber` | `outlet_counters` | Nomor berikutnya; blok nomor offline belum diimplementasikan |
| `schemaVersion` | `outlet_settings.app_schema_version` | Untuk validasi kompatibilitas |

### Field teknis sinkronisasi (belum ada di `PosStore`)

Daftar ini adalah metadata sync, bukan field UI. Jangan menganggapnya sudah ada di kode.

- `outletId`, `deviceId` pada store/record.
- `createdAtServer` hanya di cloud, bukan di UI.
- `revision` pada katalog/pengaturan.
- `clientSeq` pada outbox.
- `numberBlockStart`/`numberBlockEnd` untuk penomoran offline — **belum diimplementasikan**; DDL saat ini hanya memakai satu `outlet_counters.next_transaction_number`.

Tidak ada `cogsAmount`/`unitCost` pada transaksi di kode saat ini; jangan menambahkannya ke skema sampai domain lokal benar-benar menulis snapshot itu.

Penambahan ini tidak mengubah tombol, layar, atau urutan langkah kasir.

---

### 4.1 Bukti sumber yang dipersist

Singkatan path di bagian 4: `SettingsTab.tsx` = `src/screens/owner/SettingsTab.tsx`; `receipt.ts` = `src/lib/receipt.ts`; `printer-connection.ts` = `src/lib/printer-connection.ts`; `schema.ts` = `src/lib/schema.ts`; `settings.ts` = `src/domain/settings.ts`; `pos.ts` = `src/domain/pos.ts`.

| Sumber | Key / lokasi | Bukti kode | Peran |
|---|---|---|---|
| IndexedDB `sabana-pos` → object store `kv` | `pos-store` | `src/lib/storage.ts:19-26`, `:111-169`; `src/lib/persistence.ts:10-28` | State operasional utama; sumber kebenaran lokal |
| IndexedDB `kv` | `backup:latest` | `src/lib/storage.ts:24`; `src/lib/backup.ts:230` | Backup terakhir; metadata ke `outlet_snapshots`, file ke Storage |
| IndexedDB `kv` | `meta:legacy-migration` | `src/lib/storage.ts:23`, `:161-167` | Penanda migrasi localStorage; lokal saja |
| localStorage | `sabana-pos-store-v1` | `src/lib/storage.ts:21`; `src/lib/persistence.ts:6` | State lama; hanya sumber migrasi |
| localStorage | `sabana-pos-schema-version` | `src/lib/storage.ts:22`, `:261` | Mirror versi skema untuk tooling; lokal saja |
| localStorage fallback | `sabana-pos-backup-latest` | `src/lib/storage.ts:46-49` | Backup saat IndexedDB tidak tersedia; lokal saja |
| localStorage fallback | `sabana-pos:meta:legacy-migration` | `src/lib/storage.ts:46-50` | Penanda migrasi saat fallback; lokal saja |

Tidak ada object store lain. `openDatabase()` hanya membuat `kv` (`src/lib/storage.ts:56-59`). Aplikasi tidak memakai `sessionStorage`.

### 4.2 `PosStore`

| Field | Bukti | Tujuan |
|---|---|---|
| `schemaVersion` | `src/domain/pos.ts:91-108`; `src/lib/schema.ts:347` | `outlet_settings.app_schema_version` |
| `transactions` | `src/domain/pos.ts:93-108` | `transactions` + `transaction_items` |
| `cashMovements` | idem | `cash_movements` |
| `shifts` | idem | `shifts` |
| `heldOrders` | idem | **Lokal saja** — keranjang belum dibayar dan melekat pada perangkat |
| `preOrders` | idem | `preorders` + `preorder_items` |
| `menus` | idem | `menus` + `menu_recipes` |
| `categories` | idem | `categories` |
| `ingredients` | idem | `ingredients` |
| `stockMovements` | idem | `stock_movements` |
| `expenses` | idem | `expenses` |
| `auditLog` | idem | `audit_log` |
| `settings` | idem | `outlet_settings` (sebagian) + lokal perangkat; lihat 4.8 |
| `nextTransactionNumber` | idem | `outlet_counters.next_transaction_number` |

### 4.3 `Transaction` dan item

`Transaction` — `src/domain/pos.ts:25-40`.

| Field | Tujuan |
|---|---|
| `id` | `transactions.id` |
| `number` | `transactions.number` |
| `createdAt` | `transactions.created_at` |
| `orderType` | `transactions.order_type` |
| `paymentMethod` | `transactions.payment_method` |
| `items` | `transaction_items` |
| `subtotal` | `transactions.subtotal` |
| `paidAmount` | `transactions.paid_amount` |
| `change` | `transactions.change_amount` |
| `status` | `transactions.status` |
| `note` | `transactions.note` |
| `statusReason` | `transactions.status_reason` |
| `statusChangedAt` | `transactions.status_changed_at` |
| `shiftId` | `transactions.shift_id` |

`CartItem` — `src/domain/pos.ts:15-23`.

| Field | Tujuan |
|---|---|
| `id` | `transaction_items.menu_id` — ID menu, bukan PK baris |
| `name` | `transaction_items.name` (snapshot) |
| `category` | `transaction_items.category` (snapshot) |
| `price` | `transaction_items.price` (snapshot) |
| `qty` | `transaction_items.qty` |
| `emoji` | `transaction_items.emoji` |
| `imageUrl` | `transaction_items.image_url` (snapshot) |

`transaction_items.id` dan `line_no` adalah kolom teknis baru untuk urutan baris; bukan field di `CartItem`.

**Catatan migrasi:** `normalizeTransaction()` dan `normalizeCashMovement()` dapat menghasilkan `shiftId: ''` untuk data lama (`src/lib/schema.ts:196`, `:210`). Sebelum push, petakan record itu ke satu shift `legacy` per outlet. `transactions.shift_id` dan `cash_movements.shift_id` sengaja `not null` agar kas tidak lepas dari shift; jangan mengosongkannya.

### 4.4 `CashMovement`, `Shift`, `HeldOrder`

`CashMovement` — `src/domain/pos.ts:42-49`.

| Field | Tujuan |
|---|---|
| `id` | `cash_movements.id` |
| `createdAt` | `cash_movements.created_at` |
| `type` | `cash_movements.type` |
| `amount` | `cash_movements.amount` |
| `note` | `cash_movements.note` |
| `shiftId` | `cash_movements.shift_id` |

`Shift` — `src/domain/pos.ts:51-58`.

| Field | Tujuan |
|---|---|
| `id` | `shifts.id` |
| `openedAt` | `shifts.opened_at` |
| `closedAt` | `shifts.closed_at` |
| `openingFloat` | `shifts.opening_float` |
| `actualCash` | `shifts.actual_cash` |
| `status` | `shifts.status` |

`HeldOrder` — `src/domain/pos.ts:60-65`.

| Field | Tujuan |
|---|---|
| `id` | **Lokal saja** — belum menjadi penjualan |
| `createdAt` | **Lokal saja** — timestamp perangkat |
| `items` | **Lokal saja** — snapshot keranjang |
| `orderType` | **Lokal saja** — konteks keranjang |

Alasan: held order adalah keranjang yang belum dibayar dan tidak boleh muncul sebagai penjualan di perangkat lain. Jika nanti disinkronkan, perlu tabel `held_orders` dan keputusan produk terpisah.

### 4.5 `PreOrder`

`PreOrder` — `src/domain/pos.ts:67-80`.

| Field | Tujuan |
|---|---|
| `id` | `preorders.id` |
| `createdAt` | `preorders.created_at` |
| `customerName` | `preorders.customer_name` |
| `pickupAt` | `preorders.pickup_at` |
| `items` | `preorder_items` |
| `orderType` | `preorders.order_type` |
| `total` | `preorders.total` |
| `dp` | `preorders.dp` |
| `paymentMethod` | `preorders.payment_method` |
| `status` | `preorders.status` |
| `note` | `preorders.note` |
| `transactionId` | `preorders.transaction_id` |

`preorder_items` memakai pemetaan item yang sama dengan `transaction_items`, dengan `preorder_id` sebagai induk.

### 4.6 Katalog

`MenuCategory` — `src/domain/catalog.ts:1-4`.

| Field | Tujuan |
|---|---|
| `id` | `categories.id` |
| `name` | `categories.name` |
| urutan array `categories[]` | `categories.sort_order` (diturunkan dari indeks array) |

`Menu` — `src/domain/catalog.ts:22-32`.

| Field | Tujuan |
|---|---|
| `id` | `menus.id` |
| `name` | `menus.name` |
| `category` | `menus.category_id` — dicari dari `categories.name` |
| `price` | `menus.price` |
| `emoji` | `menus.emoji` |
| `imageUrl` | `menus.image_url` |
| `active` | `menus.active` |
| `recipe` | `menu_recipes` |

`imageUrl` boleh berupa data URL saat ini, sehingga kolom `text` bisa besar. Fase 4 memindahkan file ke Storage dan menyimpan path/URL di `menus.image_url`; jangan memecah field ini sebelum migrasi foto dilakukan.

`RecipeLine` — `src/domain/catalog.ts:17-20`: `ingredientId` → `menu_recipes.ingredient_id`, `qty` → `menu_recipes.qty`; `menu_id` berasal dari menu induk.

`Ingredient` — `src/domain/catalog.ts:6-15`.

| Field | Tujuan |
|---|---|
| `id` | `ingredients.id` |
| `name` | `ingredients.name` |
| `unit` | `ingredients.unit` |
| `costPerUnit` | `ingredients.cost_per_unit` |
| `purchaseUnit` | `ingredients.purchase_unit` |
| `purchasePrice` | `ingredients.purchase_price` |
| `usagePerPurchaseUnit` | `ingredients.usage_per_purchase_unit` |
| `minStock` | `ingredients.min_stock` |

### 4.7 Stok, beban, audit, akuntansi

`StockMovement` — `src/domain/inventory.ts:6-21`.

| Field | Tujuan |
|---|---|
| `id` | `stock_movements.id` |
| `createdAt` | `stock_movements.created_at` |
| `ingredientId` | `stock_movements.ingredient_id` |
| `type` | `stock_movements.type` |
| `qty` | `stock_movements.qty` |
| `totalCost` | `stock_movements.total_cost` |
| `note` | `stock_movements.note` |
| `unitCost` | `stock_movements.unit_cost` — hanya opname |
| `countedQty` | `stock_movements.counted_qty` — hanya opname |
| `systemQty` | `stock_movements.system_qty` — hanya opname |

`Expense` — `src/domain/accounting.ts:6-12`: `id`, `createdAt`, `category`, `amount`, `note` → `expenses`.

`AuditEntry` — `src/domain/pos.ts:84-89`: `id`, `createdAt`, `action`, `detail` → `audit_log`. `actor_id`, `entity_type`, `entity_id`, dan `device_id` adalah kolom teknis opsional; kode saat ini tidak mengisinya.

`Account` — `src/domain/accounting.ts:16`: `code`, `name`, `type` → `accounts`. Ini konstanta `chartOfAccounts` (`src/domain/accounting.ts:28-50`), bukan state yang dipersist.

`JournalEntry` / `JournalLine` — `src/domain/accounting.ts:18-26` dan `buildJournals()` (`:52-156`). Jurnal **diturunkan** dari transaksi, kas, stok, dan expense; bukan object store.

| Field | Tujuan |
|---|---|
| `JournalEntry.id` | `journal_entries.id` |
| `JournalEntry.date` | `journal_entries.date` |
| `JournalEntry.description` | `journal_entries.description` |
| `JournalEntry.source` | `journal_entries.source_type` |
| `JournalEntry.lines` | `journal_lines` |
| `JournalLine.account` | `journal_lines.account_code` |
| `JournalLine.debit` / `credit` | `journal_lines.debit` / `credit` |

Tipe turunan laporan seperti `UsageRow` (`src/domain/inventory.ts:23-33`), `BuildInput` (`src/domain/accounting.ts:44-50`), dan `LedgerRow` (`src/domain/accounting.ts:158`) tidak dipersist dan tidak perlu kolom.

### 4.8 Pengaturan

`AppSettings` — `src/domain/settings.ts:33-41`. `PrinterSettings` — `src/domain/settings.ts:5-19`. `OwnerPinRecord` — `src/domain/settings.ts:21-31`.

| Key pengaturan | Dipakai di | Target |
|---|---|---|
| `businessName` | `SettingsTab.tsx:19,79`; `receipt.ts:50` | `outlet_settings.business_name` |
| `outletName` | `SettingsTab.tsx:20,80`; `receipt.ts:51` | `outlet_settings.outlet_name` |
| `receiptFooter` | `SettingsTab.tsx:21,81`; `receipt.ts:52` | `outlet_settings.receipt_footer` |
| `theme` | `App.tsx:56-57`; `SettingsTab.tsx:22,36` | **Lokal saja** — preferensi tampilan per perangkat |
| `printer.deviceName` | `SettingsTab.tsx:23,114`; `printer-connection.ts:137` | **Lokal saja** — printer berbeda per perangkat |
| `printer.paperWidth` | `SettingsTab.tsx:24,86`; `receipt.ts:53` | `outlet_settings.paper_width` |
| `printer.autoPrint` | `App.tsx:109`; `SettingsTab.tsx:25,87` | **Lokal saja** — perilaku cetak per perangkat |
| `printer.headerAlign` | `SettingsTab.tsx:26,88`; `receipt.ts:54` | `outlet_settings.header_align` |
| `printer.footerAlign` | `SettingsTab.tsx:27,89`; `receipt.ts:55` | `outlet_settings.footer_align` |
| `printer.fontSize` | `SettingsTab.tsx:28,90`; `receipt.ts:56` | `outlet_settings.font_size` |
| `printer.showOrderType` | `SettingsTab.tsx:29,91`; `receipt.ts:57` | `outlet_settings.show_order_type` |
| `printer.showPaymentDetail` | `SettingsTab.tsx:30,92`; `receipt.ts:58` | `outlet_settings.show_payment_detail` |
| `printer.copies` | `SettingsTab.tsx:31,93`; `receipt.ts:59` | `outlet_settings.copies` |
| `printer` transport/status/connected | `SettingsTab.tsx:32`; `printer-connection.ts:54-115` | **Runtime lokal** — kapabilitas perangkat, tidak dipersist |
| `ownerPin.salt` | `schema.ts:99-109`; `App.tsx:118` | **Lokal saja** — hash kunci UI perangkat |
| `ownerPin.hash` | idem | **Lokal saja** |
| `ownerPin.recoverySalt` | idem | **Lokal saja** |
| `ownerPin.recoveryHash` | idem | **Lokal saja** |
| `ownerPin.updatedAt` | idem | **Lokal saja** |

**Catatan sinkronisasi:** karena `theme`, `printer.deviceName`, dan `printer.autoPrint` lokal, adapter sync harus menggabungkan `outlet_settings` dari cloud dengan field lokal ini; jangan menimpa objek `settings` secara utuh.

### 4.9 Backup

`BackupRecord` — `src/lib/backup.ts:21-31`; `BackupSummary` — `:11-19`.

| Field | Tujuan |
|---|---|
| `format` | Payload file backup di Storage (bukan kolom DB) |
| `formatVersion` | Payload file backup di Storage |
| `schemaVersion` | `outlet_snapshots.schema_version` |
| `createdAt` | `outlet_snapshots.created_at` |
| `reason` | `outlet_snapshots.reason` |
| `summary` | Payload file backup; angka dapat dihitung ulang |
| `summary.transactions` / `menus` / `ingredients` / `categories` / `shifts` | **Turunan** — dihitung dari `store`, tidak perlu kolom |
| `summary.outletName` / `businessName` | **Turunan** — dari `store.settings`, bukan kolom snapshot |
| `store` | File backup (idealnya terenkripsi) di Storage |

`backup:latest` tetap lokal; salinan cloud adalah snapshot terpisah di `outlet_snapshots` + Storage.

### 4.10 Tabel teknis dan turunan

| Tabel | Alasan ada | Bukan sumber field UI |
|---|---|---|
| `outlets` | Identitas tenant/outlet untuk RLS | `outletId` adalah metadata sync |
| `outlet_members` | Auth + role owner/cashier | Ditentukan Supabase Auth |
| `outlet_counters` | Nomor transaksi berikutnya | Diturunkan dari `nextTransactionNumber` |
| `sync_mutations` | Idempotensi per `device_id` + `client_seq` | Metadata sync |
| `outlet_snapshots` | Metadata backup cloud | Diturunkan dari `BackupRecord` |
| `accounts` | Chart of accounts | Konstanta `chartOfAccounts` |
| `journal_entries`, `journal_lines` | Laporan double-entry | Diturunkan `buildJournals()` |

Kolom teknis yang tidak berasal dari field UI: `outlet_id`, `revision`, `created_at_server`, `updated_at`, `deleted_at`, `device_id`, `created_by`, `line_no`, `checksum`, `storage_path`, `size_bytes`, `client_seq`, `payload_hash`. Kolom ini hanya untuk sync, audit, urutan, atau optimasi; jangan dianggap field model.

### 4.11 Field yang tidak ada di kode

| Kandidat | Status | Bukti |
|---|---|---|
| Pajak / PPN / `tax` | **Tidak ada** | Tidak ada di `AppSettings`/`PosStore`; `rg -i "tax|ppn|pajak"` tidak menemukan field state |
| Service charge | **Tidak ada** | Tidak ada di tipe maupun UI |
| Diskon tersimpan | **Tidak ada** | Hanya label `Diskon —` di `App.tsx:224`; total = subtotal |
| Pembulatan | **Tidak ada** | Tidak ada field/step pembulatan |
| `closeShiftNote` / catatan buka shift | **Runtime saja** | Input ada, tetapi tidak masuk `Shift` atau audit; bukan model persistensi |
| `cart`, `modal`, `cash`, `printerStatus`, `storageError`, `online` | **Runtime saja** | React state; tidak ada di `PosStore` |
| `heldOrders` | **Lokal saja** | `src/domain/pos.ts:60-65`; lihat 4.4 |

Jangan menambahkan kolom pajak/service charge/diskon sampai field itu benar-benar ada di domain dan UI.

### 4.12 Gap yang ditemukan dan diperbaiki

- `shifts.opening_float` default disamakan dengan kode: **350000** (`schema.ts` `DEFAULT_FLOAT`).
- `outlet_counters.next_transaction_number` default disamakan dengan state awal: **274** (`pos.ts:110-125`).
- Default `outlet_settings.business_name`, `outlet_name`, `receipt_footer` disamakan dengan `defaultSettings` (`settings.ts:43-58`).
- `theme`, `printer.deviceName`, dan `printer.autoPrint` **dikeluarkan** dari `outlet_settings` karena perangkat; tidak disinkronkan.
- Tabel `devices` dan kolom `cogs_amount`/`unit_cost` pada transaksi **dihapus** dari draft karena belum ada di kode.
- Tidak ada field operasional yang ditemukan tanpa tujuan: seluruh field `PosStore`, katalog, transaksi, stok, beban, audit, pengaturan, dan backup sudah dipetakan atau sengaja lokal.

---

## 5. DDL draft

> **Belum dijalankan.** Ini rancangan untuk migration Supabase CLI. Jalankan di project lokal/staging lebih dulu, lalu `supabase db lint` dan uji RLS.

```sql
-- Prasyarat Supabase: schema auth dan role authenticated sudah ada.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Identitas dan pengaturan
-- ---------------------------------------------------------------------------

create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Jakarta',
  currency text not null default 'IDR',
  created_at timestamptz not null default now()
);

create table public.outlet_members (
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'cashier')),
  created_at timestamptz not null default now(),
  primary key (outlet_id, user_id)
);

create table public.outlet_settings (
  outlet_id uuid primary key references public.outlets(id) on delete cascade,
  business_name text not null default 'SABANA FRIED CHICKEN',
  outlet_name text not null default 'Outlet utama',
  receipt_footer text not null default 'Terima kasih • Sabana POS',
  paper_width smallint not null default 58 check (paper_width in (58, 80)),
  header_align text not null default 'left' check (header_align in ('left', 'center')),
  footer_align text not null default 'left' check (footer_align in ('left', 'center')),
  font_size text not null default 'normal' check (font_size in ('compact', 'normal', 'large')),
  show_order_type boolean not null default true,
  show_payment_detail boolean not null default true,
  copies smallint not null default 1 check (copies between 1 and 3),
  app_schema_version integer not null default 6,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table public.outlet_counters (
  outlet_id uuid primary key references public.outlets(id) on delete cascade,
  next_transaction_number bigint not null default 274 check (next_transaction_number > 0)
);

-- ---------------------------------------------------------------------------
-- Katalog
-- ---------------------------------------------------------------------------

create table public.categories (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, outlet_id)
);

create unique index categories_outlet_name_uq
  on public.categories (outlet_id, lower(name))
  where deleted_at is null;

create table public.menus (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  category_id text not null,
  name text not null,
  price numeric(14, 2) not null check (price >= 0),
  emoji text not null default '',
  image_url text,
  active boolean not null default true,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, outlet_id),
  foreign key (category_id, outlet_id) references public.categories (id, outlet_id)
);

create table public.ingredients (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  name text not null,
  unit text not null,
  cost_per_unit numeric(14, 4) not null check (cost_per_unit >= 0),
  purchase_unit text not null default '',
  purchase_price numeric(14, 2) not null default 0 check (purchase_price >= 0),
  usage_per_purchase_unit numeric(14, 3) not null default 1 check (usage_per_purchase_unit > 0),
  min_stock numeric(14, 3) not null default 0 check (min_stock >= 0),
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, outlet_id)
);

create table public.menu_recipes (
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  menu_id text not null,
  ingredient_id text not null,
  qty numeric(14, 3) not null check (qty > 0),
  primary key (outlet_id, menu_id, ingredient_id),
  foreign key (menu_id, outlet_id) references public.menus (id, outlet_id) on delete cascade,
  foreign key (ingredient_id, outlet_id) references public.ingredients (id, outlet_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- Operasional
-- ---------------------------------------------------------------------------

create table public.shifts (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  opened_at timestamptz not null,
  closed_at timestamptz,
  opening_float numeric(14, 2) not null default 350000 check (opening_float >= 0),
  actual_cash numeric(14, 2) check (actual_cash >= 0),
  status text not null check (status in ('open', 'closed')),
  opened_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  device_id text,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, outlet_id)
);

create unique index shifts_one_open_per_outlet
  on public.shifts (outlet_id)
  where status = 'open';

create table public.transactions (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  number text not null,
  created_at timestamptz not null,
  order_type text not null check (order_type in ('Takeaway', 'Dine in', 'GoFood', 'GrabFood', 'ShopeeFood')),
  payment_method text not null check (payment_method in ('Cash', 'QRIS', 'Unpaid')),
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0),
  change_amount numeric(14, 2) not null default 0 check (change_amount >= 0),
  status text not null check (status in ('completed', 'cancelled', 'refunded')),
  note text,
  status_reason text,
  status_changed_at timestamptz,
  shift_id text not null,
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1,
  created_at_server timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, number),
  unique (id, outlet_id),
  foreign key (shift_id, outlet_id) references public.shifts (id, outlet_id) on delete restrict
);

create table public.transaction_items (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  transaction_id text not null,
  line_no integer not null check (line_no > 0),
  menu_id text,
  name text not null,
  category text not null,
  price numeric(14, 2) not null check (price >= 0),
  qty numeric(14, 3) not null check (qty > 0),
  emoji text,
  image_url text,
  unique (transaction_id, line_no),
  foreign key (transaction_id, outlet_id) references public.transactions (id, outlet_id) on delete restrict
);

create table public.cash_movements (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  shift_id text not null,
  type text not null check (type in ('in', 'out')),
  amount numeric(14, 2) not null check (amount > 0),
  note text not null,
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1,
  created_at timestamptz not null,
  created_at_server timestamptz not null default now(),
  foreign key (shift_id, outlet_id) references public.shifts (id, outlet_id) on delete restrict
);

create table public.stock_movements (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  ingredient_id text not null,
  type text not null check (type in ('purchase', 'adjustment', 'opname')),
  qty numeric(14, 3) not null,
  total_cost numeric(14, 2) not null default 0 check (total_cost >= 0),
  note text not null default '',
  unit_cost numeric(14, 4) check (unit_cost >= 0),
  counted_qty numeric(14, 3),
  system_qty numeric(14, 3),
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1,
  created_at timestamptz not null,
  created_at_server timestamptz not null default now(),
  foreign key (ingredient_id, outlet_id) references public.ingredients (id, outlet_id) on delete restrict
);

create table public.expenses (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  category text not null check (category in ('Bahan', 'Gaji', 'Sewa', 'Listrik & air', 'Internet', 'Transportasi', 'Perawatan', 'Platform', 'Lain-lain')),
  amount numeric(14, 2) not null check (amount > 0),
  note text not null default '',
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1,
  created_at timestamptz not null,
  created_at_server timestamptz not null default now()
);

create table public.preorders (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  customer_name text not null,
  pickup_at timestamptz not null,
  order_type text not null check (order_type in ('Takeaway', 'Dine in', 'GoFood', 'GrabFood', 'ShopeeFood')),
  total numeric(14, 2) not null check (total >= 0),
  dp numeric(14, 2) not null default 0 check (dp >= 0),
  payment_method text not null check (payment_method in ('Cash', 'QRIS', 'Unpaid')),
  status text not null check (status in ('draft', 'dp_received', 'processing', 'completed', 'cancelled')),
  note text,
  transaction_id text,
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (dp <= total),
  unique (id, outlet_id),
  foreign key (transaction_id, outlet_id) references public.transactions (id, outlet_id) on delete restrict
);

create table public.preorder_items (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  preorder_id text not null,
  line_no integer not null check (line_no > 0),
  menu_id text,
  name text not null,
  category text not null,
  price numeric(14, 2) not null check (price >= 0),
  qty numeric(14, 3) not null check (qty > 0),
  emoji text,
  image_url text,
  unique (preorder_id, line_no),
  foreign key (preorder_id, outlet_id) references public.preorders (id, outlet_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Akuntansi dan audit
-- ---------------------------------------------------------------------------

create table public.accounts (
  code text primary key,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense'))
);

create table public.journal_entries (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  date timestamptz not null,
  description text not null,
  source_type text not null check (source_type in ('sale', 'cogs', 'cash', 'purchase', 'opname', 'expense')),
  source_id text not null,
  posted_at timestamptz not null default now(),
  unique (outlet_id, source_type, source_id)
);

create table public.journal_lines (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  entry_id text not null references public.journal_entries(id) on delete cascade,
  account_code text not null references public.accounts(code),
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  check (debit = 0 or credit = 0),
  check (debit > 0 or credit > 0)
);

create table public.audit_log (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  detail text not null default '',
  entity_type text,
  entity_id text,
  device_id text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Backup dan idempotensi sync
-- ---------------------------------------------------------------------------

create table public.outlet_snapshots (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  schema_version integer not null,
  reason text not null check (reason in ('daily', 'before-shift-close', 'manual', 'legacy')),
  created_at timestamptz not null,
  device_id text,
  checksum text not null,
  storage_path text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0)
);

create table public.sync_mutations (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  device_id text not null,
  client_seq bigint not null,
  entity_type text not null,
  entity_id text not null,
  operation text not null,
  payload_hash text not null,
  applied_at timestamptz not null default now(),
  result jsonb,
  check (client_seq > 0),
  unique (outlet_id, device_id, client_seq)
);

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------

create index categories_outlet_idx on public.categories (outlet_id, sort_order) where deleted_at is null;
create index menus_outlet_idx on public.menus (outlet_id, category_id) where deleted_at is null;
create index ingredients_outlet_idx on public.ingredients (outlet_id) where deleted_at is null;
create index transactions_outlet_created_idx on public.transactions (outlet_id, created_at desc);
create index transactions_shift_idx on public.transactions (outlet_id, shift_id);
create index transactions_status_idx on public.transactions (outlet_id, status);
create index transaction_items_transaction_idx on public.transaction_items (transaction_id);
create index cash_movements_shift_idx on public.cash_movements (outlet_id, shift_id);
create index stock_movements_outlet_created_idx on public.stock_movements (outlet_id, created_at desc);
create index stock_movements_ingredient_idx on public.stock_movements (outlet_id, ingredient_id);
create index expenses_outlet_created_idx on public.expenses (outlet_id, created_at desc);
create index preorders_outlet_pickup_idx on public.preorders (outlet_id, pickup_at) where status not in ('completed', 'cancelled');
create index journal_entries_outlet_date_idx on public.journal_entries (outlet_id, date);
create index journal_lines_entry_idx on public.journal_lines (entry_id);
create index audit_log_outlet_created_idx on public.audit_log (outlet_id, created_at desc);
create index sync_mutations_outlet_idx on public.sync_mutations (outlet_id, applied_at);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.revision = old.revision + 1;
  return new;
end;
$$;

create trigger categories_touch before update on public.categories
for each row execute function public.touch_row();
create trigger menus_touch before update on public.menus
for each row execute function public.touch_row();
create trigger ingredients_touch before update on public.ingredients
for each row execute function public.touch_row();
create trigger shifts_touch before update on public.shifts
for each row execute function public.touch_row();
create trigger transactions_touch before update on public.transactions
for each row execute function public.touch_row();
create trigger preorders_touch before update on public.preorders
for each row execute function public.touch_row();
create trigger outlet_settings_touch before update on public.outlet_settings
for each row execute function public.touch_row();

-- ---------------------------------------------------------------------------
-- Chart of accounts awal
-- ---------------------------------------------------------------------------

insert into public.accounts (code, name, type) values
  ('1000', 'Kas Kasir', 'asset'),
  ('1100', 'Piutang QRIS', 'asset'),
  ('1150', 'Piutang Platform & Pelanggan', 'asset'),
  ('1200', 'Persediaan Bahan', 'asset'),
  ('2000', 'DP Pelanggan', 'liability'),
  ('3000', 'Modal Pemilik', 'equity'),
  ('3100', 'Setoran Pemilik', 'equity'),
  ('3200', 'Prive Pemilik', 'equity'),
  ('4000', 'Penjualan', 'revenue'),
  ('5000', 'Harga Pokok Penjualan', 'expense'),
  ('6000', 'Beban Operasional', 'expense'),
  ('6100', 'Selisih Persediaan', 'expense'),
  ('6900', 'Selisih Kas', 'expense')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Hak tabel minimum. RLS tetap membatasi baris yang boleh dibaca/ditulis.
-- Sesuaikan jika project memakai default privileges Supabase yang berbeda.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;

grant select on public.outlets, public.outlet_members,
  public.outlet_settings, public.categories, public.menus, public.ingredients,
  public.menu_recipes, public.shifts, public.transactions,
  public.transaction_items, public.cash_movements, public.stock_movements,
  public.expenses, public.preorders, public.preorder_items, public.accounts,
  public.journal_entries, public.journal_lines, public.audit_log,
  public.outlet_snapshots
  to authenticated;

grant insert, update, delete on public.outlet_members to authenticated;
grant update on public.outlets to authenticated;
grant insert, update on public.outlet_settings to authenticated;
grant insert, update on public.categories, public.menus, public.ingredients to authenticated;
grant insert, update, delete on public.menu_recipes to authenticated;
grant insert on public.outlet_snapshots to authenticated;
-- Mutasi transaksi, kas, shift, stok, expense, preorder, jurnal, dan audit
-- tidak diberi grant tulis langsung. Semua lewat RPC security definer.
```

### Catatan DDL

- `unique (id, outlet_id)` pada tabel induk diperlukan agar foreign key komposit tidak bisa menyeberangi outlet.
- `shifts_one_open_per_outlet` adalah pengaman server, bukan pengganti validasi UI.
- `journal_entries` unik per `(outlet_id, source_type, source_id)` mencegah jurnal ganda saat sync diulang.
- `sync_mutations` adalah kunci idempotensi untuk mutasi yang dipanggil lewat RPC.
- `outlet_snapshots` hanya menyimpan metadata; file backup masuk Storage, bukan kolom JSONB.

---

## 6. RLS dan hak akses

### Helper

```sql
create or replace function public.is_outlet_member(target_outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.outlet_members m
    where m.outlet_id = target_outlet
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_outlet_owner(target_outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.outlet_members m
    where m.outlet_id = target_outlet
      and m.user_id = auth.uid()
      and m.role = 'owner'
  );
$$;

revoke all on function public.is_outlet_member(uuid) from public;
revoke all on function public.is_outlet_owner(uuid) from public;
grant execute on function public.is_outlet_member(uuid) to authenticated;
grant execute on function public.is_outlet_owner(uuid) to authenticated;
```

### Contoh policy

```sql
alter table public.outlets enable row level security;
create policy outlets_member_read on public.outlets
  for select to authenticated
  using (public.is_outlet_member(id));
create policy outlets_owner_update on public.outlets
  for update to authenticated
  using (public.is_outlet_owner(id))
  with check (public.is_outlet_owner(id));

alter table public.outlet_members enable row level security;
create policy members_read_self_or_owner on public.outlet_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_outlet_owner(outlet_id));
create policy members_owner_insert on public.outlet_members
  for insert to authenticated
  with check (public.is_outlet_owner(outlet_id));
create policy members_owner_update on public.outlet_members
  for update to authenticated
  using (public.is_outlet_owner(outlet_id))
  with check (public.is_outlet_owner(outlet_id));
create policy members_owner_delete on public.outlet_members
  for delete to authenticated
  using (public.is_outlet_owner(outlet_id));

alter table public.outlet_settings enable row level security;
create policy settings_member_read on public.outlet_settings
  for select to authenticated
  using (public.is_outlet_member(outlet_id));
create policy settings_owner_update on public.outlet_settings
  for update to authenticated
  using (public.is_outlet_owner(outlet_id))
  with check (public.is_outlet_owner(outlet_id));

alter table public.accounts enable row level security;
create policy accounts_authenticated_read on public.accounts
  for select to authenticated
  using (true);

alter table public.categories enable row level security;
create policy categories_member_read on public.categories
  for select to authenticated
  using (public.is_outlet_member(outlet_id));
create policy categories_owner_write on public.categories
  for insert to authenticated
  with check (public.is_outlet_owner(outlet_id));
create policy categories_owner_update on public.categories
  for update to authenticated
  using (public.is_outlet_owner(outlet_id))
  with check (public.is_outlet_owner(outlet_id));

alter table public.transactions enable row level security;
create policy transactions_member_read on public.transactions
  for select to authenticated
  using (public.is_outlet_member(outlet_id));
-- Tidak ada policy INSERT/UPDATE/DELETE: semua mutasi lewat RPC security definer.

alter table public.journal_entries enable row level security;
create policy journal_owner_read on public.journal_entries
  for select to authenticated
  using (public.is_outlet_owner(outlet_id));

alter table public.menu_recipes enable row level security;
create policy recipes_member_read on public.menu_recipes
  for select to authenticated
  using (public.is_outlet_member(outlet_id));
create policy recipes_owner_write on public.menu_recipes
  for all to authenticated
  using (public.is_outlet_owner(outlet_id))
  with check (public.is_outlet_owner(outlet_id));

alter table public.outlet_snapshots enable row level security;
create policy snapshots_owner_read on public.outlet_snapshots
  for select to authenticated
  using (public.is_outlet_owner(outlet_id));
create policy snapshots_owner_insert on public.outlet_snapshots
  for insert to authenticated
  with check (public.is_outlet_owner(outlet_id));

alter table public.sync_mutations enable row level security;
-- Tidak ada policy untuk authenticated. Hanya service role/RPC yang menyentuh tabel ini.
```

> **Wajib:** setiap tabel yang diberi `grant select` di atas harus punya policy `SELECT`. RLS bersifat default-deny; grant saja tidak membuka baris. Ulangi pola `using (public.is_outlet_member(outlet_id))` untuk tabel yang boleh dibaca kasir, dan `using (public.is_outlet_owner(outlet_id))` untuk tabel owner-only (`stock_movements`, `expenses`, `journal_*`, `audit_log`).
>
> **Bootstrap owner pertama:** buat baris `outlets` dan `outlet_members` lewat SQL/service role. Belum ada owner yang bisa memberikan izin kepada dirinya sendiri lewat RLS.

### Matriks akses

| Tabel | Kasir | Pemilik | Tulis lewat |
|---|---|---|---|
| `outlets` | baca | baca + ubah | dashboard/RPC |
| `outlet_members` | baca miliknya | kelola | RPC/dashboard |
| `outlet_settings` | baca | ubah | RLS owner |
| `categories`, `menus`, `ingredients`, `menu_recipes` | baca | CRUD | RLS owner |
| `transactions`, `transaction_items` | baca | baca | RPC `record_sale` |
| `shifts` | baca | baca | RPC `open_shift`, `close_shift` |
| `cash_movements` | baca | baca | RPC `record_cash_movement` |
| `stock_movements` | tidak | baca | RPC `record_stock_movement` |
| `expenses` | tidak | baca | RPC `record_expense` |
| `preorders` | baca | baca | RPC transisi status |
| `accounts` | baca | baca | migration |
| `journal_entries`, `journal_lines` | tidak | baca | RPC internal |
| `audit_log` | tidak | baca | RPC internal |
| `outlet_snapshots` | tidak | baca/unggah | RLS owner + Storage |
| `sync_mutations` | tidak | tidak | RPC/service role |

### Aturan penting

- **Jangan** memberi `INSERT` langsung ke `transactions`, `journal_*`, atau `audit_log`. RPC harus memvalidasi jumlah, status, membership, dan idempotensi.
- **Jangan** menyimpan `owner_pin` di Supabase. `ownerPin` tetap di IndexedDB perangkat.
- **Jangan** memakai `service_role` di browser; key itu melewati RLS.
- **Jangan** mengandalkan UI untuk otorisasi. RLS adalah batas sebenarnya.
- Bucket foto menu dan backup harus private; akses lewat signed URL atau RLS Storage.

---

## 7. RPC minimum

| RPC | Fungsi | Aturan |
|---|---|---|
| `record_sale(payload jsonb)` | insert transaksi + item + audit | membership, idempotensi `sync_mutations`, subtotal = Σ(harga × qty), `paid_amount`/`change_amount` valid, shift milik outlet |
| `record_cash_movement(payload jsonb)` | kas masuk/keluar | shift harus `open`, amount > 0, note wajib |
| `open_shift(payload jsonb)` | buka shift | tolak jika sudah ada shift `open` |
| `close_shift(payload jsonb)` | tutup shift | hitung kas seharusnya di server, simpan `actual_cash`, audit, idempotensi |
| `record_stock_movement(payload jsonb)` | pembelian/adjustment/opname | qty/unit cost valid; opname menyimpan snapshot |
| `record_expense(payload jsonb)` | beban | amount > 0, kategori valid |
| `transition_preorder(payload jsonb)` | DP/proses/selesai/batal | state machine; `processing` membuat transaksi + stok |
| `reserve_transaction_numbers(outlet, device, count)` | blok nomor | atomik, kembalikan `start`/`end` |
| `post_journal(payload jsonb)` | posting jurnal | dipanggil internal; debit = kredit; unik per source |

### Kerangka idempotensi

```sql
create or replace function public.record_sale(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outlet uuid := (payload->>'outlet_id')::uuid;
  v_device text := payload->>'device_id';
  v_seq bigint := (payload->>'client_seq')::bigint;
  v_tx_id text := payload->>'id';
  v_existing public.sync_mutations%rowtype;
begin
  if not public.is_outlet_member(v_outlet) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_existing
  from public.sync_mutations
  where outlet_id = v_outlet
    and device_id = v_device
    and client_seq = v_seq;

  if found then
    return coalesce(v_existing.result, jsonb_build_object('id', v_existing.entity_id));
  end if;

  if exists (select 1 from public.transactions where id = v_tx_id) then
    return jsonb_build_object('id', v_tx_id);
  end if;

  -- Validasi payload: subtotal, paid_amount, change_amount, shift, status.
  -- Insert transaksi + item + audit dalam satu transaksi database.
  -- Insert sync_mutations dengan client_seq yang sama.

  return jsonb_build_object('id', v_tx_id);
end;
$$;

revoke all on function public.record_sale(jsonb) from public;
grant execute on function public.record_sale(jsonb) to authenticated;
```

Implementasi lengkap `record_sale` harus memakai `jsonb_to_recordset` untuk item, memeriksa ulang total, dan menulis audit. Kerangka di atas hanya menunjukkan pola idempotensi dan membership.

---

## 8. Protokol sync

### 8.1 Outbox lokal

```ts
type OutboxItem = {
  id: string                 // UUID mutasi
  outletId: string
  deviceId: string
  clientSeq: number          // naik monoton per device
  entity: 'transaction' | 'cash_movement' | 'shift' | 'stock_movement' | 'expense' | 'preorder'
  entityId: string
  operation: 'create' | 'update'
  payload: unknown
  createdAt: string
  attempts: number
  lastError?: string
}
```

Ditulis ke IndexedDB bersama `pos-store` dalam **satu transaksi IndexedDB**. Jika wrapper saat ini hanya bisa menulis satu key, tambahkan `writeBatch()` agar state dan outbox tidak pernah terpisah.

### 8.2 Push

1. Ambil outbox tertua, kelompokkan per entity.
2. Panggil RPC dengan `client_seq` dan `payload`.
3. Server mengembalikan hasil yang tersimpan; klien menghapus outbox.
4. Gagal jaringan → exponential backoff + jitter; jangan hapus.
5. Gagal validasi (4xx) → tandai `needs_attention`, tampilkan di ikon sync; jangan retry buta.
6. Sukses → perbarui `lastSyncedAt`.

### 8.3 Pull

- Katalog/pengaturan: `updated_at > lastPulledAt`, termasuk baris `deleted_at`.
- Transaksi: `created_at > lastPulledAt` untuk laporan pemilik; kasir tidak perlu menarik semua transaksi.
- Realtime hanya untuk katalog, pengaturan, preorder, dan status shift.
- Setelah pull, jalankan `normalizeStore()` yang sudah ada agar bentuk data tetap kompatibel.

### 8.4 Aturan konflik

| Entitas | Aturan |
|---|---|
| Transaksi | Append-only. ID sama = idempotent; payload berbeda = tolak + audit. |
| Kas/stok/expense | Append-only. Koreksi = reversal, bukan edit. |
| Shift | Satu `open` per outlet; tutup lewat RPC; `actual_cash` final. |
| Katalog/pengaturan | Optimistic `revision`; `base_revision` salah → 409, pemilik menyelesaikan. |
| Preorder | State machine; transisi hanya lewat RPC. |
| Held order | Lokal perangkat pada fase awal; jika disinkronkan, konflik diselesaikan per `device_id`. |

### 8.5 Nomor transaksi offline

Gunakan **blok nomor**:

- `reserve_transaction_numbers(outlet, device, 100)` mengembalikan `start`/`end`.
- Perangkat menyimpan blok dan memakai nomor berikutnya secara lokal.
- Jika blok habis saat offline, transaksi tetap disimpan dengan nomor sementara `POS-TMP-<device>-<seq>`; server dapat menetapkan nomor final saat sync (opsional, mengubah tampilan struk) atau menolak dan meminta kasir menyelesaikan saat online.
- Untuk satu outlet, blok 100–500 nomor cukup untuk beberapa hari.

Alternatif yang lebih sederhana: nomor berprefix perangkat, mis. `POS-A-000123`, unik tetapi tidak berurutan global. Pilih satu sebelum implementasi.

---

## 9. Rencana migrasi bertahap

### Fase 0 — Baseline dan pemetaan (lokal, tanpa cloud)

**Perubahan:** tidak ada UI. Tambah metadata lokal (`outletId`, `deviceId`, `revision`, `updatedAt`) lewat migrasi skema v7; siapkan exporter dari backup JSON ke staging.

**Aktivitas:**
- Unduh backup JSON terbaru; uji restore di browser bersih.
- Buat daftar ID: kategori, menu, bahan, transaksi, shift.
- Petakan `menu.category` (nama) → `category_id`.
- Hitung ekspektasi: jumlah baris, total penjualan, kas per shift, jurnal debit/kredit.
- Buat fixture `scripts/fixtures/supabase-seed.json` dari data nyata (tanpa PIN).

**Exit criteria:**
- Backup bisa direstore 100%.
- Semua ID unik; tidak ada referensi resep yatim.
- Angka kontrol cocok dengan aplikasi lokal.

### Fase 1 — Fondasi Supabase (belum dipakai aplikasi)

**Aktivitas:**
- Buat project Supabase region Singapura.
- Jalankan DDL di staging; `supabase db lint`.
- Buat outlet, owner membership, akun chart of accounts.
- Seed katalog + stok + transaksi historis lewat script satu arah.
- Uji RLS: owner vs cashier, user outlet lain, anon.

**Exit criteria:**
- Migration apply bersih di database kosong.
- Seed row count dan total uang sama dengan backup.
- RLS menolak akses lintas outlet dan menolak kasir menulis katalog.
- Tidak ada service role key di bundle.

### Fase 2 — Cloud backup satu arah

**Aktivitas:**
- Bucket private `pos-backups`.
- Setelah backup lokal harian/sebelum tutup shift, enkripsi JSON di klien lalu unggah.
- Simpan metadata di `outlet_snapshots`.
- Aplikasi tetap membaca/menulis IndexedDB saja.

**Exit criteria:**
- Tujuh snapshot harian berturut-turut, checksum cocok.
- Restore dari snapshot cloud ke browser bersih berhasil.
- Upload gagal tidak mengganggu kasir; status muncul di ikon sync.

### Fase 3 — Shadow push transaksi

**Aktivitas:**
- Tambah outbox dan `writeBatch()`.
- Push transaksi, kas, shift, stok, expense setelah simpan lokal.
- RPC idempotent; tidak ada pull.
- Rekonsiliasi harian: jumlah transaksi, total, kas per shift.

**Exit criteria:**
- 100% transaksi lokal masuk cloud.
- Replay outbox tidak menggandakan transaksi/jurnal.
- Mode pesawat: jual 20 transaksi, reload, online, semua tersinkron.
- Checkout tidak pernah menunggu jaringan.

### Fase 4 — Pull katalog dan realtime

**Aktivitas:**
- Pull katalog/pengaturan saat start dan saat online.
- Owner mengubah harga → push dengan `revision`; kasir menerima lewat realtime.
- Foto menu diunggah ke Storage; lokal menyimpan cache.
- Konflik katalog ditampilkan ke pemilik, bukan ke kasir.

**Exit criteria:**
- Ubah harga di perangkat pemilik → tampil di kasir < 5 detik saat online.
- Offline memakai cache terakhir.
- Konflik `base_revision` ditolak dan tidak menimpa data.

### Fase 5 — Dua arah dan multi-perangkat

**Aktivitas:**
- Laporan pemilik membaca agregat cloud.
- Preorder dan status shift disinkronkan.
- Blok nomor transaksi; dua perangkat menjual bersamaan.
- Posting jurnal di server untuk sale/COGS/cash/stock/expense; rekonsiliasi dengan jurnal lokal.
- Held order tetap lokal atau disinkronkan per device (putuskan).

**Exit criteria:**
- Dua perangkat menjual 50 transaksi bersamaan tanpa nomor duplikat.
- Jurnal debit = kredit; PNL cloud = PNL lokal.
- Shift hanya satu yang `open`; tutup shift dari perangkat mana pun konsisten.
- Tidak ada data hilang saat satu perangkat offline 24 jam.

### Fase 6 — Cutover dan hardening

**Aktivitas:**
- Feature flag `syncEnabled` (default mati sampai fase 5 lolos).
- Deploy production; monitoring error sync; alert backlog.
- Backup restore drill bulanan; retensi `sync_mutations` dan `audit_log`.
- Review biaya/kuota Supabase.

**Exit criteria:**
- Produksi berjalan 7 hari tanpa kehilangan transaksi.
- RLS test, restore test, dan offline test masuk CI.
- Rollback terbukti: matikan flag → kasir tetap berjualan lokal.

---

## 10. Rollback

1. Set `syncEnabled = false`; aplikasi kembali 100% lokal.
2. Jangan hapus IndexedDB atau data cloud.
3. Ekspor data cloud ke JSON sebelum perubahan skema besar.
4. Jika migrasi lokal v7 bermasalah, restore backup v6; `normalizeStore()` harus tetap membaca v6.
5. Jangan pernah menjadikan cloud satu-satunya sumber tanpa backup lokal.

---

## 11. Verifikasi yang harus disiapkan

### SQL / RLS
- Migration apply dari database kosong.
- `supabase db lint`.
- Uji dua user: owner outlet A, kasir outlet A, user outlet B.
- Pastikan `anon` tidak bisa membaca transaksi.
- Pastikan kasir tidak bisa insert/update `menus`, `journal_entries`, atau `outlet_settings`.

### Data
- Row count per tabel = hasil mapping.
- `sum(transaction_items.price * qty) = transactions.subtotal` per transaksi.
- `sum(journal_lines.debit) = sum(journal_lines.credit)`.
- Kas seharusnya per shift = float + cash sales + cash in − cash out.
- `next_transaction_number > max(number)`.

### Offline / sync
- Matikan jaringan → jual → reload → online → tidak ada duplikat.
- Dua perangkat offline → jual bersamaan → sync → nomor unik.
- Replay outbox 3× → jumlah transaksi tidak berubah.
- Restore snapshot cloud → data sama dengan backup lokal.

### Keamanan
- `SUPABASE_SERVICE_ROLE_KEY` tidak ada di bundle/`dist`.
- `ownerPin` tidak ada di payload cloud.
- Bucket backup/foto private; akses via signed URL.
- RLS diuji, bukan hanya UI.

---

## 12. Keputusan yang masih terbuka

1. **Format nomor transaksi:** blok nomor server vs prefix perangkat.
2. **Held order:** tetap lokal atau disinkronkan.
3. **Foto menu:** tetap data URL di Postgres atau wajib Storage.
4. **Jurnal server:** posting pada fase 3 atau fase 5.
5. **Auth kasir:** satu akun kasir bersama vs akun per perangkat.
6. **Enkripsi backup:** passphrase pemilik atau kunci perangkat.
7. **Retensi:** berapa lama `sync_mutations` dan `audit_log` disimpan.

---

## 13. Ringkasan keputusan

- **Database:** Supabase Postgres, bukan MongoDB.
- **Pola:** local-first; IndexedDB tetap sumber operasional; cloud adalah mirror/backup.
- **Uang:** `numeric`; snapshot harga/biaya di transaksi.
- **Keamanan:** Supabase Auth + RLS; PIN pemilik tetap lokal.
- **Mutasi kritis:** lewat RPC idempoten, bukan insert langsung.
- **Migrasi:** mulai dari backup satu arah, lalu shadow push, lalu pull katalog, baru dua arah.
- **Alur kasir:** tidak berubah; tidak ada network await di checkout.
