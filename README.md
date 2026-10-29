# Sabana POS — aplikasi kasir FnB

POS untuk outlet FnB, dirancang untuk tablet dan mobile Android.
Ada dua mode: **kasir** dan **pemilik**.

> **Status backend (Oktober 2026):** aplikasi personal **satu outlet** yang berjalan **100% online**. Data
> outlet — menu, bahan, pembelian, transaksi, shift, dan pengaturan — disimpan di **Supabase** dan
> dilindungi RLS; login hanya satu akun pemilik, bukan multi-tenant/SaaS.
> Tanpa env Supabase, build berjalan dalam **mode lokal** (demo) untuk pengembangan dan `check:ui`;
> build produksi wajib mengisi env Supabase di Vercel.

Tampilan mengikuti ukuran layar: di tablet lanskap katalog dan keranjang menggulir sendiri di dalam viewport sehingga tombol bayar selalu terlihat tanpa menggeser halaman; di tablet potret kedua panel berbagi satu viewport (masing-masing menggulir sendiri), sedangkan di ponsel halaman menggulir normal; mode pemilik memakai sidebar di layar lebar dan tab horizontal yang bisa digeser di layar sempit.

## Menjalankan

```sh
bun install
bun run dev        # http://localhost:3000 (Vite + Worker di workerd)
bun run build      # dist/client + dist/saas_landing/index.js
bun run typecheck
bun run check:domain    # domain: kas, HPP, forecast, jurnal, struk, migrasi state lama
bun run check:runtime   # jsdom: mount App, PIN, buka layar pemilik, ubah harga, kembali ke POS
bun run check:ui        # Chromium: CRUD, kategori, gambar, bulk, printer, shift/struk, overflow
bun run check:storage   # fake-indexeddb: migrasi localStorage, idempotensi, backup, gagal tulis
bun run check:repo      # repo Supabase dengan gateway tiruan: load/save, diff, hapus, dokumen, error
bun run check:sql       # Postgres asli (PGlite): semua migration, RLS per tabel, alur checkout
```

`bun run check:ui` memerlukan Chromium Playwright sekali: `bunx playwright install --with-deps chromium`. Skrip memakai dev server di `:3000` bila sedang hidup, atau menyalakan server Vite sendiri; set `UI_BASE_URL` untuk menunjuk server lain, `UI_CHECK_OWN_SERVER=1` untuk selalu menyalakan server sendiri (CI), dan `UI_CHECK_SCREENSHOTS=0` untuk mematikan screenshot. Screenshot tersimpan di `.screenshots/ui-check/` (gitignored). Hasil per pemeriksaan ditulis ke `artifacts/ui-check-report.json` bila `UI_CHECK_REPORT` diisi, atau `.screenshots/ui-check/report.json` bila tidak.

Workflow `.github/workflows/ci.yml` menjalankan `bun run typecheck`, seluruh `check:*` (domain, runtime, storage, repo, sql), dan `check:ui` headless pada setiap push, lalu mengunggah laporan JSON + screenshot sebagai artefak.

`bun run check:sql` menjalankan semua file di `supabase/migrations/` secara berurutan pada Postgres asli (PGlite/WASM, tanpa Docker) dengan stub Supabase (`auth.uid()`, role `anon`/`authenticated`). Skrip menulis sebagai owner outlet untuk setiap tabel yang dipakai aplikasi, memastikan akun outlet lain dan `anon` ditolak, menjalankan checkout penuh (shift → transaksi → `transaction_items` → total), lalu mencetak jumlah PASS/FAIL dan exit non-zero bila ada yang gagal. Ini yang menangkap bug seperti policy `transaction_items` yang tidak cocok dengan trigger.

## Deploy production di Vercel

Repo sudah memuat `vercel.json`; aplikasi POS adalah SPA statis, dan Supabase diakses langsung dari browser memakai anon key + RLS. Vercel hanya perlu build env, bukan server API.

1. **Siapkan Supabase lebih dulu** — ikuti [`supabase/README.md`](supabase/README.md): jalankan `0001_init.sql` → `0002_rls.sql` → `0003_transaction_items_write.sql` → `0004_shifts_delete.sql` (sekali, berurutan), aktifkan provider Email, dan buat akun pemilik.
2. Import repo ke Vercel. Konfigurasi dari `vercel.json` menetapkan **install** `bun install --frozen-lockfile`, **build** `bun run build`, dan **output** `dist/client`.
3. Isi **Environment Variables** (Production dan Preview):

   | Variabel | Wajib | Isi |
   | --- | --- | --- |
   | `VITE_SUPABASE_URL` | ya | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | ya | anon/publishable key dari Project Settings → API |

   Tidak ada env outlet: aplikasi selalu memakai outlet dari akun pemilik yang login (tabel `staff`).

   **Redeploy wajib setelah mengubah env**, karena Vite menanamkan nilai saat build. Jangan memakai `service_role` key, kata sandi database, atau password pemilik di klien.
4. Deploy menghasilkan URL HTTPS. HTTPS wajib untuk PIN (`crypto.subtle`) dan Web Bluetooth; service worker hanya aktif pada build production.
5. Buka aplikasi → masuk dengan **satu akun pemilik**. Outlet dibuat otomatis pada login pertama (RPC `create_outlet`), katalog dimulai **kosong** tanpa menu/bahan contoh, dan tidak ada onboarding, pilihan outlet, atau manajemen staf. Tambahkan menu dan bahan sendiri dari mode pemilik.
6. `vercel.json` menambahkan rewrite SPA agar refresh/deep link kembali ke `index.html`, header keamanan, cache `sw.js` yang tidak lengket, serta tipe konten manifest.

### Checklist deploy

- [ ] `bun run typecheck`, `bun run build`, dan `bun run check:sql` exit 0 secara lokal; `dist/client` berisi `index.html`, `assets/`, `sw.js`, dan `manifest.webmanifest`.
- [ ] Supabase SQL Editor: `0001_init.sql` → `0002_rls.sql` → `0003_transaction_items_write.sql` → `0004_shifts_delete.sql`, sekali dan berurutan (jangan mengulang `0001`/`0002`).
- [ ] Supabase Authentication: provider Email aktif, satu akun pemilik dibuat.
- [ ] Vercel Environment Variables (Production + Preview): `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`; tidak ada service role/password di klien.
- [ ] Deploy, lalu buka `/` dan refresh di path dalam (mis. `/settings`) — harus memuat aplikasi, bukan 404.
- [ ] Login pemilik → outlet dibuat dengan katalog kosong → tambah menu/bahan → buka shift → bayar tunai → transaksi tersimpan dan struk bisa dicetak.
- [ ] Setiap mengubah env, redeploy (Vite menanamkan nilai saat build).

Catatan: endpoint Hono di `src/worker/index.ts` hanya tersedia pada deployment Cloudflare, bukan pada deployment Vercel statis. Aplikasi POS tidak memanggil endpoint tersebut. Data operasional berada di Supabase sehingga beberapa perangkat melihat outlet yang sama (last-write-wins per baris).

### Jika muncul "new row violates row-level security policy"

Artinya akun yang login belum terdaftar sebagai `owner` untuk outlet yang dipakai (mis. akun dibuat ulang atau baris `staff` menunjuk outlet lain). Buka Supabase → SQL Editor, periksa lalu perbaiki:

Jika pesannya menyebut tabel `transaction_items`, penyebabnya berbeda: jalankan `supabase/migrations/0003_transaction_items_write.sql`. Tanpa migration itu, trigger transaksi tidak diizinkan menulis baris item sehingga pembayaran ikut gagal. Jika pesannya menyebut tabel `shifts` atau data shift tidak ikut terhapus saat restore, jalankan `supabase/migrations/0004_shifts_delete.sql`.

```sql
-- 1) Periksa akun, peran, dan outlet yang terdaftar
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

Lalu muat ulang aplikasi. Outlet tidak bisa diatur lewat env, jadi tidak ada nilai build yang bisa menimpa akses akun.

## PWA & offline

`bun run build` menyalin `manifest.webmanifest` + ikon 192/512/maskable dan menghasilkan `sw.js` yang mem-precache shell (`/`, JS/CSS ber-hash, ikon, aset menu) dengan nama cache berversi per build. `/index.html` sengaja tidak di-precache karena hosting produksi me-redirect-nya ke `/`, dan respons redirect tidak boleh memenuhi navigasi offline. Service worker hanya didaftarkan pada build produksi; navigasi memakai network-first dengan fallback `index.html` dari cache (deep link tetap bekerja), aset memakai stale-while-revalidate, dan request non-GET serta `/api/*` tidak pernah di-cache. Status service worker dan ketersediaan install tampil di **Pengaturan → Aplikasi & offline**. `check:ui` membangun produksi, menyajikannya lokal, memutus jaringan, lalu reload untuk membuktikan shell dan katalog tetap berfungsi. Pada mode online, shell tetap dimuat offline tetapi data Supabase baru tersedia setelah jaringan kembali.

## APK Android (printer Bluetooth native)

Folder [`android/`](android/README.md) berisi shell WebView untuk aplikasi production dan bridge printer Bluetooth native. Ini jalur yang dipakai untuk RPP02N agar koneksi tidak bergantung pada Web Bluetooth yang putus saat layar mati.

```sh
cd android
./gradlew assembleDebug
# hasil: android/app/build/outputs/apk/debug/app-debug.apk
```

APK debug memakai halaman production di `android/app/src/main/res/values/strings.xml` (default `https://zafian.vercel.app`). Karena halaman diambil dari web, **deploy ulang build web terbaru sebelum memasang APK** agar shim auto-connect ikut termuat. Bridge mendukung Bluetooth Classic/SPP (jalur umum RPP02N) dan BLE; printer yang dipilih disimpan, lalu disambungkan ulang otomatis saat mencetak. APK debug ditandatangani dengan debug keystore—buat signed APK/AAB sebelum distribusi permanen. Cetak dengan RPP02N fisik belum diuji di sandbox.

## Alur kasir

1. Buka shift (float default Rp350.000, bisa disesuaikan).
2. Pilih menu → pilih tipe pesanan (Takeaway default, Dine in, GoFood, GrabFood, ShopeeFood).
3. Proses → pilih Cash atau QRIS → cetak struk → selesai.

Kanal GoFood/GrabFood/ShopeeFood tidak memproses pembayaran; hanya dicatat dengan catatan.
Cash memakai numpad, preset uang pas, dan preset sampai Rp100.000 dengan kembalian ter-highlight.

Fitur kasir lain: tahan pesanan (lanjut/hapus), pre-order dengan DP (mulai proses, pelunasan),
cash in/out dengan catatan, tutup shift dengan selisih kas, riwayat transaksi berpaginasi,
detail struk dengan void dan cetak ulang.

## Mode pemilik

Klik avatar **P** di topbar, atau ikon printer untuk langsung membuka pengaturan printer. Keduanya meminta **PIN pemilik** bila sudah dibuat. Navigasi memakai sidebar pada tablet/desktop dan tab horizontal pada layar sempit.

- **Ringkasan** — filter periode (hari ini, 7/30 hari, bulan ini, atau rentang kustom), delapan metrik penjualan/laba/HPP/persediaan dengan pembanding periode sebelumnya, grafik tren penjualan, komposisi pembayaran Cash/QRIS/belum terbayar, kanal pesanan, kategori teratas, pola jam pesanan, menu terlaris, bahan di bawah minimum, dan aksi cepat.
- **Menu & HPP** — **tambah, ubah, dan hapus menu**; unggah foto; pilih kategori; atur status jual, harga, dan resep bahan. HPP/margin dihitung ulang otomatis. Tersedia pencarian dan filter kategori.
- **Kategori** — tambah, ubah nama, urutkan, dan hapus kategori. Rename ikut memperbarui menu terkait; kategori yang masih dipakai tidak bisa dihapus.
- **Bahan & stok** — **tambah, ubah, dan hapus bahan** (tombol hapus tersedia langsung di tabel dan di editor, memakai dialog konfirmasi di dalam aplikasi agar tetap bekerja di preview iframe/WebView; bahan yang masih dipakai resep meminta konfirmasi eksplisit **“Hapus & lepas dari resep”** sehingga baris resep ikut dibersihkan dan tidak ada resep menggantung); **pembelian massal** beberapa bahan dalam satu kali simpan, dengan mode **per satuan** atau **per pack** (jumlah pack otomatis dikonversi ke satuan pakai dan biaya dihitung dari harga kemasan); **opname stok** untuk menambah, mengedit, dan menghapus hasil hitung fisik beserta selisihnya, dengan **nilai selisih otomatis dijurnal**; penyesuaian stok +/- dengan catatan; stok minimum dan pemakaian teoretis.
- **Forecast** — kebutuhan harian dan mingguan berdasarkan rata-rata 7 hari, stok, dan saran pembelian.
- **Laporan** — PNL, biaya operasional, neraca saldo, neraca, dan buku besar dari jurnal double-entry otomatis, termasuk penyesuaian selisih persediaan dari opname.
- **Pengaturan** — identitas usaha/outlet, catatan kaki struk, **baris promo struk** (opsional, maks. 3 baris di atas footer), tema, **PIN pemilik**, pairing printer Bluetooth, lebar kertas 58/80 mm, tata letak struk (perataan header/footer, ukuran font, isi struk, jumlah salinan), cetak otomatis setelah pembayaran, tes cetak, dan ringkasan data.
- **Backup** — backup harian otomatis, backup sebelum tutup shift, unduh backup terakhir/baru, restore dengan pratinjau dan konfirmasi, ekspor CSV penjualan dan jurnal, audit log.

### Printer & struk

Ada dua bentuk distribusi: **web/PWA** (`dist/client` + Worker) dan **shell Android** di `android/`. Shell Android membungkus halaman production di WebView dan menyediakan bridge Bluetooth native (Classic/SPP dan BLE) yang menyimpan printer serta auto-connect sebelum setiap struk. Di browser, transport printer dipilih otomatis oleh `src/lib/printer-connection.ts`:

1. **Native** — hanya jika shell Android/webview menyuntikkan `window.SabanaPrinter` (kontrak `NativePrinterBridge` di `src/lib/printer-connection.ts`). Bridge menerima payload ESC/POS base64, menyimpan alamat RPP02N, dan mencoba auto-connect sebelum menulis byte ke BLE atau Bluetooth Classic/SPP.
2. **Web Bluetooth (BLE)** — Chrome/Edge Android atau desktop, HTTPS/localhost. Tombol **Cari & pasangkan** membuka pemilih perangkat; **Hubungkan ulang** memakai izin browser; **Putuskan** menutup koneksi GATT.
3. **Dialog cetak sistem** — fallback di WebView/browser tanpa bridge maupun Web Bluetooth.

- Panel **Printer & struk** menampilkan transport aktif, status terhubung, dan diagnostik bila pairing tidak tersedia. Tombol pairing/reconnect/putuskan menyesuaikan kapabilitas transport; **Tes cetak struk** tetap tersedia dan memakai transport aktif atau dialog sistem.
- Payload ESC/POS dibentuk satu kali di `src/lib/escpos.ts` (inisialisasi, perintah ukuran font `ESC !`, teks, umpan kertas, potong) untuk semua transport. Jumlah salinan 1–3 diterapkan pada payload yang sama, dan ukuran font ikut terkirim ke printer thermal (compact = Font B, besar = tinggi ganda), bukan hanya ke dialog cetak.
- Tata letak dapat diatur: perataan header dan footer (kiri/tengah), ukuran font (kecil/normal/besar — dipakai di pratinjau, dialog cetak, dan payload ESC/POS), tampil/tidaknya tipe pesanan dan rincian pembayaran, serta 1–3 salinan. Pratinjau memakai fungsi struk yang sama dengan hasil cetak.
- Auto-print setelah pembayaran, cetak ulang dari riwayat, dan tes cetak semuanya memakai abstraksi transport yang sama. Jika pengiriman gagal, kasir diberi tahu dan dapat mencetak ulang tanpa membuat transaksi baru.
- **BLE vs Bluetooth Classic:** Web Bluetooth hanya menjangkau printer BLE. Printer thermal lama berbasis Bluetooth Classic/SPP memerlukan shell native dengan bridge (mis. plugin Android SPP); bridge native juga bisa memakai BLE.

**Verifikasi di perangkat fisik:**

1. Jalankan build di origin HTTPS (atau localhost) dan buka dengan Chrome Android.
2. Nyalakan printer BLE, buka **Pengaturan → Printer & struk**. Panel harus menampilkan **Web Bluetooth (BLE)** dan tombol pairing aktif.
3. Klik **Cari & pasangkan**, pilih printer, lalu pastikan status menjadi **TERHUBUNG** dan nama perangkat muncul.
4. Klik **Tes cetak struk**; periksa teks, perataan, jumlah salinan, umpan, dan potong kertas.
5. Muat ulang halaman, klik **Hubungkan ulang**, lalu uji auto-print setelah pembayaran dan cetak ulang dari riwayat.
6. Untuk printer Classic/SPP, ulangi lewat shell Android yang menyediakan `window.SabanaPrinter`; tanpa bridge, panel akan menampilkan **Dialog cetak sistem** dan pairing dinonaktifkan dengan pesan diagnostik.

### Gambar menu

- Menu seed memakai ilustrasi SVG lokal di `public/menu/` sehingga tetap tampil offline.
- Foto unggahan dikompresi di browser (maks. 560 px, JPEG) lalu disimpan sebagai data URL di katalog.
- Di kasir, keranjang, dan mode pemilik gambar memakai `object-fit: contain` dalam wadah 4:3, jadi **tidak terpotong** meskipun rasio foto berbeda.
- Jika foto belum ada atau gagal dimuat, emoji menu menjadi fallback.

## Data, skema, dan migrasi

- **Mode online (produksi):** env Supabase terisi → aplikasi meminta login, membaca seluruh data outlet dari tabel Supabase, lalu setiap perubahan dikirim sebagai upsert baris yang berubah (hapus dikirim sebagai delete). `src/lib/repo/*` adalah satu-satunya jalur data; IndexedDB tidak ditulis. Bila jaringan gagal, penyimpanan ditolak dan alert muncul di aplikasi (tidak ada antrean offline).
- **Mode lokal (tanpa env, untuk pengembangan/check:ui):** data memakai **IndexedDB** (`sabana-pos` → object store `kv`, key `pos-store`) melalui `src/lib/storage.ts`; `localStorage` hanya fallback runtime lama/WebView dan lokasi migrasi satu kali. Mode ini bukan mode produksi.
- Skema Supabase ada di `supabase/migrations/` (tabel per entitas, RLS per outlet, trigger `transaction_items`, RPC `create_outlet`). Detail operasional ada di [`supabase/README.md`](supabase/README.md).
- Konflik antar perangkat memakai *last-write-wins* lewat `updated_at`; tidak ada merge per field.
- Saat pertama dibuka, state `sabana-pos-store-v1` dari localStorage dimigrasikan ke IndexedDB. Migrasi hanya berjalan bila key `pos-store` belum ada, ditandai `meta:legacy-migration`, dan **tidak menghapus** data lama. Membuka ulang tidak menimpa IndexedDB.
- Kegagalan tulis/kuota penuh ditampilkan sebagai alert penyimpanan di aplikasi dengan tombol coba lagi; tidak ada catch kosong pada jalur simpan.
- Versi skema saat ini `8`, disimpan di field `schemaVersion` dan key `sabana-pos-schema-version`.
- `src/lib/schema.ts` menjalankan `normalizeStore()` setiap kali load, save, export, dan restore backup.
- Skema v6 menambahkan `settings.ownerPin` berisi hash SHA-256 + salt dan hash kode pemulihan. PIN/kode asli tidak disimpan; kode pemulihan hanya ditampilkan sekali saat PIN dibuat atau diubah.
- Skema v3 menambahkan `categories`, `settings` (identitas, tema, printer/struk), dan `menu.imageUrl`. Pengaturan lama otomatis mendapat default aman.
- Skema v4 menambahkan snapshot `unitCost` pada opname dan jurnal penyesuaian persediaan. Opname lama tanpa biaya snapshot diisi dari biaya bahan saat migrasi lalu dibekukan.
- Skema v5 menambahkan pengaturan tata letak struk (`headerAlign`, `footerAlign`, `fontSize`, `showOrderType`, `showPaymentDetail`, `copies`); state lama mendapat default kiri/normal/tampil semua/1 salinan.
- Skema v6 menambahkan PIN pemilik. PIN di-hash `SHA-256(salt:PIN)` via `crypto.subtle`; kode pemulihan memakai salt terpisah dan juga di-hash. PIN wajib untuk mode pemilik, pengaturan (termasuk printer), void, ubah menu/harga, dan tutup shift. Kasir tetap bisa membuka aplikasi dan berjualan tanpa PIN.
- Backup JSON memakai wrapper `sabana-pos-backup` berisi `schemaVersion`, `createdAt`, `reason`, ringkasan, dan seluruh state. Backup otomatis dibuat sekali sehari (dicek saat aplikasi dibuka dan berkala tiap 30 menit) serta tepat sebelum tutup shift; backup terakhir disimpan di IndexedDB dan bisa diunduh.
- Restore memvalidasi format, versi skema, serta struktur transaksi/menu/bahan/kategori sebelum menampilkan ringkasan dan meminta konfirmasi. File rusak, versi lebih baru, atau data yang akan hilang ditolak tanpa mengubah state. PIN pemilik perangkat saat ini dipertahankan saat restore.
- Opname disimpan sebagai `StockMovement` bertipe `opname` dengan snapshot `systemQty`, `countedQty`, dan `unitCost`; `qty` adalah selisih yang dipakai perhitungan stok. Selisihnya dijurnal ke **Persediaan Bahan (1200)** dan **Selisih Persediaan (6100)**, sehingga PNL dan neraca ikut menyesuaikan. Opname bisa diedit/dihapus tanpa mengubah riwayat pembelian.
- Migrasi bersifat **idempoten**: dijalankan dua kali menghasilkan state yang sama, tanpa menambah transaksi, kas, atau jurnal.
- Di **mode lokal**, state lama tanpa katalog/bahan/kategori/audit akan di-seed otomatis; harga, resep, status menu, dan kategori buatan pengguna **tidak** di-reset. Mode online tidak men-seed outlet baru — katalog dimulai kosong.
- Kategori yang dipakai menu tetap dipertahankan walau belum ada di daftar kategori; urutan kategori tersimpan mengikuti pengaturan pemilik.
- Transaksi lama tanpa `paidAmount`/`change` diturunkan dari subtotal (`change` = 0) sehingga kas tidak menjadi `NaN`.
- Pre-order lama tanpa `dp` dianggap DP 0; shift lama tanpa `openingFloat` memakai Rp350.000.
- Record lama tanpa `id` mendapat ID fallback berbasis indeks agar tidak bertabrakan.
- Transaksi tidak pernah dihapus; void/refund mengubah status dan mencatat alasan.
- Identitas record memakai `createId()` dengan fallback untuk WebView lama tanpa `crypto.randomUUID`.

### Hasil verifikasi rilis (28 Oktober 2026)

- `bun run typecheck` — lolos, exit 0.
- `bun run build` — lolos (`dist/client` + Worker, aset menu ikut ter-copy).
- `VERCEL=1 bun run build` — lolos tanpa `.env.local`: SPA + `manifest.webmanifest` + `sw.js` (25 aset di-precache), tanpa Worker Cloudflare.
- `bun run check:domain` — **163 pemeriksaan lolos** (migrasi state lama, no-NaN cash, idempotensi tanpa duplikasi kas/jurnal, kategori menu & bahan, pengaturan, gambar menu/item, opname stok & snapshot, jurnal opname, struk 58/80 mm, **baris promo struk**, transport printer, periode ringkasan, backup round-trip, **validasi backup rusak/versi lebih baru**, **hash PIN & kode pemulihan**).
- `bun run check:storage` — **14 pemeriksaan lolos** dengan fake-indexeddb: migrasi localStorage, migrasi kedua tidak menimpa IndexedDB, backup harian tidak dobel, backup sebelum tutup shift, unduhan file JSON, dan kegagalan tulis ditolak (tidak ditelan).
- `bun run check:runtime` — **163 pemeriksaan lolos** di jsdom: App ter-mount tanpa error, gambar tampil di kasir, tema tersimpan, **PIN wajib sebelum mode pemilik/pengaturan printer**, **PIN disimpan sebagai hash**, **reset PIN dengan kode pemulihan dan PIN lama tidak berlaku**, **PIN wajib untuk tutup shift dan void transaksi**, **kegagalan penyimpanan menampilkan alert**, **file restore rusak ditolak dan file valid menampilkan pratinjau sebelum ditimpa**, filter periode ringkasan, ubah harga menu, CRUD menu/bahan/kategori menu & **kategori bahan**, filter kategori bahan, pembelian massal per pack, opname, dan pengaturan printer. Verifikasi ini memakai jsdom, bukan browser grafis atau printer fisik.
- `bun run check:ui` — **117 pemeriksaan lolos** di Chromium headless (DPR 2, touch): CRUD menu + foto (buat/edit/hapus), CRUD bahan, tab kategori (tambah/ubah/hapus, proteksi kategori terpakai, strip kasir), foto menu di kasir `object-fit: contain` tanpa crop/gepeng (rasio 2:1 terukur), bulk pembelian 3 baris sekali simpan yang menambah stok ketiganya, 8 tab mode pemilik, pengaturan printer 80 mm/2 salinan + **baris promo** persist setelah reload dan terbaca pratinjau serta tes cetak, **buka shift float Rp350.000 → transaksi tunai uang pas → struk 80 mm/2 salinan tercetak → tutup shift dengan PIN dan kas aktual**, serta **cold start offline**: service worker aktif, reload tanpa jaringan tetap memuat shell, katalog dirender, dan buka shift + pilih menu tetap berfungsi; nol overflow horizontal di 1024×600, 1280×800, 800×1280, dan 360×640. Cetak ke printer thermal fisik tetap belum diuji (yang diperiksa HTML cetak).
- Dev server bind `0.0.0.0:3000`: `/`, `/src/main.tsx`, `/src/App.tsx`, `/src/lib/storage.ts`, `/src/lib/pin.ts`, `/src/lib/backup.ts`, `/src/components/OwnerPinDialog.tsx`, `/src/screens/owner/BackupTab.tsx`, `/src/screens/owner/SettingsTab.tsx`, dan `/src/styles.css` merespons HTTP 200.
- Ikon tombol dapat diganti di `public/icons/`; ilustrasi menu di `public/menu/`.

- `bun run check:repo` — **46 pemeriksaan lolos** dengan gateway Supabase tiruan: round-trip snapshot, outlet online baru mulai kosong tanpa katalog contoh, seed uji ber-ID uuid + referensi resep, penyimpanan idempoten (tanpa perubahan = nol tulis), upsert per baris, hapus baris, dokumen kas/audit/pre-order/beban, numeric PostgREST berbentuk string, nominasi transaksi diturunkan dari data, isolasi outlet, dan penolakan error jaringan.
- **Migration Supabase diuji pada PostgreSQL 18.4 lokal** dengan stub Supabase (role `anon`/`authenticated`/`service_role`, schema `auth`, `auth.uid()`/`auth.jwt()`): `0001_init.sql` + `0002_rls.sql` **apply bersih tanpa error di dua database baru** (12 tabel masing-masing), lalu **26/26 pemeriksaan RLS lolos** — owner CRUD master data, kasir hanya baca master data + tulis transaksi/shift/dokumen, kasir ditolak mengubah pengaturan/staf, user outlet lain dan `anon` ditolak, `create_outlet` idempoten, serta trigger `transaction_items` terisi dan diperbarui. Bug yang ditemukan lewat uji ini (trigger tanpa `security definer`, kolom penghitung transaksi di tabel owner-only) sudah diperbaiki.
- **Mode online belum diuji ke project Supabase hosted** karena tidak ada kredensial project. Login dengan JWT asli, klien PostgREST, dan dashboard Supabase tetap perlu diuji sekali setelah project dibuat.

### Uji manual cepat

1. Buka aplikasi dari data localStorage lama → pastikan katalog/transaksi lama muncul, lalu buka DevTools → Application → IndexedDB → `sabana-pos` → `kv` → key `pos-store`.
2. Klik avatar **P** → buat PIN → simpan kode pemulihan → pastikan mode pemilik terbuka. Tutup ke kasir dan coba lagi tanpa PIN → harus ditolak.
3. Buka **Backup** → **Backup sekarang & unduh**; muat ulang; **Unduh backup terakhir**. Coba pulihkan file rusak → harus ditolak. Pulihkan file valid → muncul ringkasan → konfirmasi → aplikasi memuat ulang.
4. Buka tutup shift → isi kas fisik → konfirmasi → masukkan PIN → shift tertutup dan backup `sebelum tutup shift` muncul di daftar backup terakhir.

## Angka dan aturan

- Kas seharusnya = float + penjualan cash + cash in − cash out.
- Penjualan cash dihitung dari `uang diterima − kembalian`.
- QRIS tidak menambah kas fisik.
- Pre-order diakui sebagai penjualan saat **Mulai proses**; pelunasan menjadi cash in.
- HPP dihitung dari resep dan harga bahan yang dapat diedit.

## Batasan saat ini

- Saat mode online, seluruh data outlet (termasuk kategori bahan dan pengaturan printer/PIN) berada di Supabase, bukan di perangkat. Multi-perangkat membaca outlet yang sama; perubahan terakhir menang per baris.
- Google Sheets belum terhubung; tersedia ekspor CSV sebagai jalur laporan.
- Tersedia shell Android native di `android/`: APK WebView + bridge Bluetooth Classic/SPP dan BLE dengan auto-connect ke printer tersimpan. Di browser biasa, cetak tetap memakai Web Bluetooth BLE.
- Cetak di APK memakai bridge native; bila belum ada printer tersimpan, aplikasi memberi pesan pairing, bukan diam-diam membuka dialog. Print thermal fisik RPP02N belum diuji di sandbox ini—yang diverifikasi adalah build APK, signature, dan shim native di jsdom.
- Pairing Web Bluetooth di browser bergantung pada Chrome/Edge (HTTPS/localhost) dan izin perangkat; di APK pairing memakai dialog native Android dan mendukung perangkat Classic yang sudah dipasangkan.
- Unduhan backup berbasis `blob:` dari WebView belum memiliki handler native; gunakan browser untuk mengunduh backup sampai handler ditambahkan.
- Foto menu disimpan sebagai data URL di IndexedDB (maks. 560 px JPEG). Backup JSON memuat foto tersebut; untuk katalog sangat besar, kapasitas perangkat tetap perlu dipantau.
- Backup JSON otomatis/unduh tetap tersedia sebagai ekspor eksplisit dan disimpan di perangkat; sumber kebenaran tetap Supabase. Belum ada backup cloud otomatis terjadwal.
- PIN memakai `crypto.subtle`; buka aplikasi lewat **HTTPS atau localhost**. Pada origin HTTP LAN biasa, PIN tidak bisa dibuat/diverifikasi (aplikasi menampilkan pesan; kasir tetap bisa berjualan, tetapi mode pemilik terkunci sampai origin aman dipakai).
- Gambar menu disimpan sebagai URL/data URL di kolom `menu_items.image_url`. Data URL besar membebani baris database; untuk katalog besar, gunakan Supabase Storage dan simpan URL-nya.
- Antrean offline belum ada: di mode online, transaksi memerlukan koneksi ke Supabase. Shell PWA tetap bisa dibuka offline, tetapi data tidak dapat dimuat/ditulis sampai jaringan kembali.
- Migration Supabase belum dieksekusi ke project nyata pada turn ini; validasi baru sebatas review SQL + `check:repo` dengan gateway tiruan.
