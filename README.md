# Sabana POS — aplikasi kasir FnB

POS offline-first untuk outlet FnB, dirancang untuk tablet dan mobile Android.
Ada dua mode: **kasir** dan **pemilik**.

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
bun run check:cloud     # mock fetch: enkripsi, auth, unggah ke bucket backup, daftar/restore snapshot
bun run check:pull      # mock fetch + websocket: paginasi pull, LWW/tombstone, realtime + polling, outbox penjualan
bun run check:db        # Postgres lokal: migration + seed + RLS + bucket backup
bun run supabase:verify # ulang 48 pemeriksaan hosted (REST + RPC) tanpa DDL/seed (butuh PAT)
```

`bun run check:ui` memerlukan Chromium Playwright sekali: `bunx playwright install --with-deps chromium`. Skrip memakai dev server di `:3000` bila sedang hidup, atau menyalakan server Vite sendiri; set `UI_BASE_URL` untuk menunjuk server lain, `UI_CHECK_OWN_SERVER=1` untuk selalu menyalakan server sendiri (CI), dan `UI_CHECK_SCREENSHOTS=0` untuk mematikan screenshot. Screenshot tersimpan di `.screenshots/ui-check/` (gitignored). Hasil per pemeriksaan ditulis ke `artifacts/ui-check-report.json` bila `UI_CHECK_REPORT` diisi, atau `.screenshots/ui-check/report.json` bila tidak.

Workflow `.github/workflows/ci.yml` menjalankan `bun run typecheck`, seluruh `check:*` (domain, runtime, storage, sync, pull, db, cloud), dan `check:ui` headless pada setiap push, lalu mengunggah laporan JSON + screenshot sebagai artefak.

## Deploy production di Vercel

Repo sudah memuat `vercel.json`; aplikasi POS adalah SPA statis, jadi tidak memerlukan server API atau kredensial cloud saat build.

1. Import repo ke Vercel. Konfigurasi dari `vercel.json` sudah menetapkan **install** `bun install --frozen-lockfile`, **build** `bun run build`, dan **output** `dist/client`.
2. Saat build di Vercel (`VERCEL=1`), plugin Worker Cloudflare dilewati sehingga hanya client SPA yang dibangun. Build lokal tetap membangun Worker untuk deployment Cloudflare.
3. **Tidak ada environment variable yang wajib** untuk kasir, mode pemilik, PWA, backup lokal, atau backup cloud. Opsional: isi `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, dan `VITE_OUTLET_ID` di Vercel (Production + Preview) untuk mem-prefill form **Backup → Backup cloud**. Nilai ini masuk ke bundle publik; jangan isi password owner, frasa sandi, atau service role key. Setelah mengubah env, redeploy. Tanpa env, form tetap bisa diisi manual dan disimpan di perangkat.
4. Deploy menghasilkan URL HTTPS. HTTPS wajib untuk PIN (`crypto.subtle`) dan Web Bluetooth; service worker hanya aktif pada build production.
5. `vercel.json` menambahkan rewrite SPA agar refresh/deep link kembali ke `index.html`, header keamanan, cache `sw.js` yang tidak lengket, serta tipe konten manifest.
6. Jalankan `bunx vercel --prod` hanya setelah login Vercel, atau gunakan tombol deploy di dashboard. Deploy tidak dilakukan otomatis oleh repo ini.

Catatan: endpoint Hono di `src/worker/index.ts` hanya tersedia pada deployment Cloudflare, bukan pada deployment Vercel statis. Aplikasi POS tidak memanggil endpoint tersebut. Data operasional tetap per perangkat di IndexedDB; untuk multi-perangkat gunakan backup cloud/restore atau sinkronisasi yang sudah dikonfigurasi.

## PWA & offline

`bun run build` menyalin `manifest.webmanifest` + ikon 192/512/maskable dan menghasilkan `sw.js` yang mem-precache shell (`/`, JS/CSS ber-hash, ikon, aset menu) dengan nama cache berversi per build. `/index.html` sengaja tidak di-precache karena hosting produksi me-redirect-nya ke `/`, dan respons redirect tidak boleh memenuhi navigasi offline. Service worker hanya didaftarkan pada build produksi; navigasi memakai network-first dengan fallback `index.html` dari cache (deep link tetap bekerja), aset memakai stale-while-revalidate, dan request non-GET, `/api/*`, serta Supabase (cross-origin) tidak pernah di-cache. Status service worker dan ketersediaan install tampil di **Pengaturan → Aplikasi & offline**. `check:ui` membangun produksi, menyajikannya lokal, memutus jaringan, lalu reload untuk membuktikan shell dan katalog tetap berfungsi.

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
- **Pengaturan** — identitas usaha/outlet, catatan kaki struk, tema, **PIN pemilik**, pairing printer Bluetooth, lebar kertas 58/80 mm, tata letak struk (perataan header/footer, ukuran font, isi struk, jumlah salinan), cetak otomatis setelah pembayaran, tes cetak, dan ringkasan data.
- **Backup** — backup harian otomatis, backup sebelum tutup shift, unduh backup terakhir/baru, restore dengan pratinjau dan konfirmasi, ekspor CSV penjualan dan jurnal, audit log.

### Printer & struk

Aplikasi ini **murni web** saat ini: tidak ada folder Capacitor/Android, `capacitor.config`, atau plugin native terpasang. Build yang dikirim adalah `dist/client` + Worker. Karena itu transport printer dipilih otomatis oleh `src/lib/printer-connection.ts`:

1. **Native** — hanya jika shell Android/webview menyuntikkan `window.SabanaPrinter` (kontrak `NativePrinterBridge` di `src/lib/printer-connection.ts`). Bridge menerima payload ESC/POS base64, sehingga shell hanya menulis byte ke BLE atau Bluetooth Classic/SPP.
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

- Penyimpanan utama adalah **IndexedDB** (`sabana-pos` → object store `kv`, key `pos-store`) melalui `src/lib/storage.ts`. `localStorage` hanya menjadi fallback runtime lama/WebView dan lokasi migrasi satu kali.
- Saat pertama dibuka, state `sabana-pos-store-v1` dari localStorage dimigrasikan ke IndexedDB. Migrasi hanya berjalan bila key `pos-store` belum ada, ditandai `meta:legacy-migration`, dan **tidak menghapus** data lama. Membuka ulang tidak menimpa IndexedDB.
- Kegagalan tulis/kuota penuh ditampilkan sebagai alert penyimpanan di aplikasi dengan tombol coba lagi; tidak ada catch kosong pada jalur simpan.
- Versi skema saat ini `6`, disimpan di field `schemaVersion` dan key `sabana-pos-schema-version`.
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
- State lama tanpa katalog/bahan/kategori/audit akan di-seed otomatis; harga, resep, status menu, dan kategori buatan pengguna **tidak** di-reset.
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
- `bun run check:domain` — **160 pemeriksaan lolos** (migrasi state lama, no-NaN cash, idempotensi tanpa duplikasi kas/jurnal, kategori menu & bahan, pengaturan, gambar menu/item, opname stok & snapshot, jurnal opname, struk 58/80 mm, transport printer, periode ringkasan, backup round-trip, **validasi backup rusak/versi lebih baru**, **hash PIN & kode pemulihan**).
- `bun run check:pull` — **44 pemeriksaan lolos**: paginasi pull, kursor per outlet, idempotensi replay, tombstone, LWW + penolakan konflik, pull gagal tidak merusak data, outbox penjualan idempoten, realtime debounce + fallback polling.
- `bun run check:cloud` — **71 pemeriksaan lolos** dengan `fetch` tiruan: turunan kunci PBKDF2, enkripsi/dekripsi AES-GCM, penolakan checksum/ciphertext/frasa sandi yang salah, path snapshot per outlet, login + refresh sesi Supabase, unggah envelope + metadata `outlet_snapshots` (idempoten), pembersihan objek saat metadata gagal, status `disabled`/`pending-setup`/`ok`/`error` tanpa melempar ke kasir, daftar + unduh + restore, dan persistensi konfigurasi/sesi.
- `bun run check:db` — **58 pemeriksaan lolos**, termasuk migration 001–004: bucket `pos-backups` privat, empat policy Storage, owner bisa baca folder outletnya, kasir tidak bisa melihat/mengunggah, owner outlet lain ditolak, trigger stream sinkronisasi, paginasi `pull_changes`, dan idempotensi `apply_sale`.
- `bun run check:storage` — **14 pemeriksaan lolos** dengan fake-indexeddb: migrasi localStorage, migrasi kedua tidak menimpa IndexedDB, backup harian tidak dobel, backup sebelum tutup shift, unduhan file JSON, dan kegagalan tulis ditolak (tidak ditelan).
- `bun run check:runtime` — **148 pemeriksaan lolos** di jsdom: App ter-mount tanpa error, gambar tampil di kasir, tema tersimpan, **PIN wajib sebelum mode pemilik/pengaturan printer**, **PIN disimpan sebagai hash**, **reset PIN dengan kode pemulihan dan PIN lama tidak berlaku**, **PIN wajib untuk tutup shift dan void transaksi**, **kegagalan penyimpanan menampilkan alert**, **file restore rusak ditolak dan file valid menampilkan pratinjau sebelum ditimpa**, filter periode ringkasan, ubah harga menu, CRUD menu/bahan/kategori menu & **kategori bahan**, filter kategori bahan, pembelian massal per pack, opname, dan pengaturan printer. Verifikasi ini memakai jsdom, bukan browser grafis atau printer fisik.
- `bun run check:ui` — **94 pemeriksaan lolos** di Chromium headless (DPR 2, touch): CRUD menu + foto (buat/edit/hapus), CRUD bahan, tab kategori (tambah/ubah/hapus, proteksi kategori terpakai, strip kasir), foto menu di kasir `object-fit: contain` tanpa crop/gepeng (rasio 2:1 terukur), bulk pembelian 3 baris sekali simpan yang menambah stok ketiganya, 8 tab mode pemilik, pengaturan printer 80 mm/2 salinan persist setelah reload dan terbaca tes cetak, **buka shift float Rp350.000 → transaksi tunai uang pas → struk 80 mm/2 salinan tercetak → tutup shift dengan PIN dan kas aktual**, serta **cold start offline**: service worker aktif, reload tanpa jaringan tetap memuat shell, katalog dirender, dan buka shift + pilih menu tetap berfungsi; nol overflow horizontal di 1024×600, 1280×800, 800×1280, dan 360×640. Cetak ke printer thermal fisik tetap belum diuji (yang diperiksa HTML cetak).
- `bun run check:sync` — **113 pemeriksaan lolos**: migrasi metadata skema v8, normalisasi idempoten, pemetaan kategori→menu, shift legacy, resep duplikat, FK staging, jurnal seimbang, angka kontrol kas/penjualan, dan CLI exporter (checksum JSONL, penolakan backup rusak).
- Cakupan database yang sama juga memeriksa migration DDL 22 tabel, RLS 33 policy, seed idempoten, foreign key, angka kontrol, isolasi owner/kasir/lintas-outlet/anon, dan penolakan staging yang checksum-nya berubah. Ini bukan project Supabase cloud.
- Dev server bind `0.0.0.0:3000`: `/`, `/src/main.tsx`, `/src/App.tsx`, `/src/lib/storage.ts`, `/src/lib/pin.ts`, `/src/lib/backup.ts`, `/src/components/OwnerPinDialog.tsx`, `/src/screens/owner/BackupTab.tsx`, `/src/screens/owner/SettingsTab.tsx`, dan `/src/styles.css` merespons HTTP 200.
- Ikon tombol dapat diganti di `public/icons/`; ilustrasi menu di `public/menu/`.

### Uji manual cepat

1. Buka aplikasi dari data localStorage lama → pastikan katalog/transaksi lama muncul, lalu buka DevTools → Application → IndexedDB → `sabana-pos` → `kv` → key `pos-store`.
2. Klik avatar **P** → buat PIN → simpan kode pemulihan → pastikan mode pemilik terbuka. Tutup ke kasir dan coba lagi tanpa PIN → harus ditolak.
3. Buka **Backup** → **Backup sekarang & unduh**; muat ulang; **Unduh backup terakhir**. Coba pulihkan file rusak → harus ditolak. Pulihkan file valid → muncul ringkasan → konfirmasi → aplikasi memuat ulang.
4. Buka tutup shift → isi kas fisik → konfirmasi → masukkan PIN → shift tertutup dan backup `sebelum tutup shift` muncul di daftar backup terakhir.

## Supabase Fase 0 (lokal, tanpa cloud)

Fase 0 hanya menambah **metadata dan alat ekspor**; UI kasir serta alur jualan tidak berubah dan aplikasi tetap membaca/menulis IndexedDB.

- Skema lokal naik ke **v8** dengan `store.sync = { outletId, deviceId, revision, updatedAt }` dan `store.ingredientCategories` untuk kategori bahan. State lama otomatis mendapat placeholder deterministik (`outlet-local`, `device-local`) serta kategori bahan default agar migrasi idempoten; `updatedAt` mengikuti timestamp bisnis terakhir dan tidak pernah mundur. Nilai sync belum dikirim ke jaringan dan tidak ditampilkan di UI.
- Restore backup **tidak** memindahkan `deviceId`/`outletId` perangkat saat ini, sehingga backup dari perangkat lain tidak membuat identitas sync bertabrakan.
- Exporter memakai backup JSON yang sama dengan fitur **Backup → Unduh**:

```bash
bun run sync:export --input sabana-pos-backup-2026-10-26-manual.json --out staging/supabase
# setelah outlet dibuat di Supabase (Fase 1):
bun run sync:export --input backup.json --out staging/supabase --outlet-id <uuid> --device-id kasir-utama
```

- Output: **19 file JSONL** (`categories`, `menus`, `menu_recipes`, `ingredients`, `shifts`, `transactions`, `transaction_items`, `cash_movements`, `stock_movements`, `expenses`, `preorders`, `preorder_items`, `accounts`, `journal_entries`, `journal_lines`, `audit_log`, `outlets`, `outlet_settings`, `outlet_counters`) plus `manifest.json` berisi jumlah baris, **daftar ID** kategori/menu/bahan/transaksi/shift, angka kontrol (penjualan, kas per shift, debit/kredit jurnal, nilai pembelian/opname), daftar issue, dan **SHA-256** tiap file.
- `heldOrders` sengaja tidak diekspor (keranjang lokal). `outlet_members`, `outlet_snapshots`, dan `sync_mutations` belum diisi pada Fase 0.
- Validasi memblokir penulisan bila ada error: ID/nomor transaksi duplikat, resep/bahan yatim, lebih dari satu shift `open`, referensi shift kosong yang tidak bisa dipetakan, atau jurnal tidak seimbang. Referensi shift lama/`''` dipetakan ke `shift-legacy-local` (float 0, status `closed`) dan dicatat di manifest.
- Timestamp katalog (`menus`, `ingredients`, `categories`) diturunkan dari `sync.updatedAt` karena model lokal belum menyimpan `createdAt` per katalog; ini akan menjadi `updated_at` baris saat seed Fase 1.
- Fixture uji: `scripts/fixtures/supabase-seed.json` (deterministik, **tanpa PIN**). Ini contoh untuk menguji exporter, bukan data produksi. Untuk data nyata, unduh backup dari aplikasi lalu jalankan perintah di atas.
- Fase 0 tidak membuat project/jaringan. Migration dan uji RLS masuk di Fase 1 di bawah.

## Supabase Fase 1 (staging dibuat dan terverifikasi)

Fase 1 menyiapkan database staging. Wizard `bun run supabase:hosted` membuat/memakai project staging, menjalankan migration, membuat owner, dan men-seed sampai `verify.sql` lolos. Verifikasi REST independen sempat gagal karena mengasumsikan kolom `id` pada `menu_recipes` (tabel itu memakai primary key komposit); bug sudah diperbaiki dengan menghitung baris lewat `select=*`. Wizard yang sama lalu menerapkan **migration 003** (bucket backup) dan **migration 004** (stream sinkronisasi) ke project yang tabelinya sudah ada, dan `bun run supabase:verify` mencatat **48/48 pemeriksaan lolos** pada project `sabana-pos` (`egyaohgoyridudzoltxb`) — termasuk sembilan pemeriksaan yang memanggil RPC sinkronisasi sungguhan — dengan laporan di `supabase/hosted-report.json` (gitignored). Tidak ada kredensial yang ditulis ke repo.

Untuk mengulang pemeriksaan tanpa membuat project/DDL/seed, jalankan `bun run supabase:verify`. Mode ini membaca project dari `supabase/hosted.json` atau `SUPABASE_PROJECT_REF`, memakai pemeriksaan REST yang sama, dan hanya menulis ulang laporan.

- `supabase/migrations/202610260001_init.sql` — DDL 22 tabel, diekstrak apa adanya dari dokumen desain.
- `supabase/migrations/202610260002_rls.sql` — helper membership + **33 policy**. Dokumen desain hanya memuat contoh policy dan meminta pola diulang; migration ini melengkapinya untuk semua tabel yang punya grant `SELECT` sesuai matriks akses (kasir baca operasional; owner-only stok, beban, jurnal, audit; anon tanpa akses).
- `bun run db:seed --outlet-id <uuid> --owner-user-id <uuid>` — membaca `staging/supabase`, memverifikasi SHA-256 + jumlah baris, lalu menulis `supabase/seed/seed.sql` dan `verify.sql`. Seed memetakan `outlet_id` placeholder ke outlet baru, memasukkan owner membership, dan memeriksa ulang jumlah baris, penjualan, kas per shift, serta debit/kredit jurnal.
- `bun run check:db` — menjalankan prelude lokal (stub `auth.uid()` + role), migration, seed, uji RLS, bucket Storage, dan stream sinkronisasi di PGlite (58 pemeriksaan). Seed dijalankan dua kali — termasuk sekali **setelah semua migration** — untuk membuktikan idempotensi sekaligus kompatibilitas kolom baru; CLI seed juga diuji menolak staging yang berubah.
- Langkah hosted lengkap ada di [supabase/README.md](supabase/README.md). Ringkasnya: buat project region **Singapore**, buat user owner, tambahkan `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_URL` + `SUPABASE_DB_PASSWORD` di **Settings → Secrets**, lalu jalankan `bunx supabase link --project-ref <ref>` → `bunx supabase db push` → `bun run db:seed` → terapkan `seed.sql`/`verify.sql` lewat SQL Editor atau psql.
- **Belum termasuk**: RPC tulis (`record_sale`, `open_shift`, `post_journal`, dll.) dan koneksi aplikasi ke cloud; itu Fase 3. Aplikasi tetap membaca/menulis IndexedDB dan checkout tidak menunggu jaringan.
- Jangan menempelkan token di chat; simpan lewat **Settings → Secrets**. Untuk mengulang pemeriksaan REST tanpa menyentuh data, gunakan `bun run supabase:verify`.

## Supabase production terpisah (2026-10-28)

Production sudah disiapkan sebagai project **baru** `sabana-pos-production` (`lwirpcrggtsxcooqlriz`, `ap-southeast-1`), terpisah dari staging `sabana-pos`. Migration **001 → 004** diterapkan berurutan, owner dibuat, lalu **hanya master data** yang di-seed: 1 outlet, 1 pengaturan, 13 akun, 5 kategori, 23 bahan, 11 menu, 69 resep. Semua tabel operasional (transaksi, shift, kas, stok, beban, pre-order, jurnal, audit, snapshot) diverifikasi **0 baris**, dan counter nomor struk mulai dari **1** (`POS-1`).

Verifikasi production: **39/39 pemeriksaan lolos**, exit 0, termasuk login owner lewat magic link, unggah backup terenkripsi 24.060 byte, metadata `outlet_snapshots`, unduh + dekripsi 17.663 karakter dengan checksum cocok, validasi restore 11 menu/23 bahan, penolakan anon HTTP 400, lalu pembersihan objek + metadata sampai **0 sisa**. Laporan ada di `supabase/production-report.json` (gitignored). Ini rehearsal lewat fungsi klien dengan sesi owner asli, **bukan** klik UI Backup di browser; restore UI dan backup harian terjadwal belum diuji.

Langkah Anda berikutnya: reset password owner di **Dashboard → Authentication → Users → Reset password**, lalu isi **Backup → Backup cloud** di aplikasi dengan project URL, anon/publishable key, outlet id `cbddce27-79ad-4d1c-9964-9364c806161a`, email + password owner, dan frasa sandi. Setelah itu ganti katalog contoh dan identitas toko lewat mode pemilik. Jangan mengarahkan aplikasi ke staging dan jangan menjalankan seed staging penuh ke production. Urutan migration, bukti rehearsal, dan batasan lengkap ada di [supabase/README.md](supabase/README.md#production-terpisah--sabana-pos-production).

Jalankan ulang verifikasi tanpa mengubah data: `bun run supabase:production:verify`. Plan Free sekarang memakai dua project aktif (staging + production).

## Supabase Fase 2 (cloud backup satu arah)

Salinan backup dikirim ke bucket privat Supabase Storage. Aplikasi **tetap** membaca/menulis IndexedDB; cloud hanya salinan, tidak ada pull, realtime, atau konflik katalog.

- **Bucket** `pos-backups` (privat, limit 10 MB) dibuat oleh `supabase/migrations/202610260003_backup_storage.sql`, bersama policy Storage: hanya `owner` outlet yang boleh baca/tulis folder `pos-backups/<outlet_id>/...`. Kasir dan anon ditolak; path tanpa UUID outlet ditolak.
- **Enkripsi di klien:** frasa sandi (min. 8 karakter) → PBKDF2-SHA256 210.000 iterasi → AES-GCM 256. Envelope memuat `salt`, `iterations`, `iv`, dan `checksum` SHA-256 plaintext. Yang disimpan Supabase hanya ciphertext; anon key tetap publik, service role key tidak pernah dipakai.
- **Kapan diunggah:** otomatis setelah backup harian dan tepat setelah backup sebelum tutup shift. Tidak ada tombol backup cloud manual. `uploadBackupQuietly()` berjalan di latar belakang dan dipanggil ulang saat aplikasi dibuka, setiap 30 menit, saat perangkat kembali online, dan tepat setelah sesi cloud tersambung — snapshot yang gagal diunggah dicoba lagi otomatis. Kegagalan hanya mengubah status, tidak membatalkan transaksi atau tutup shift.
- **Sambung otomatis:** aktivasi cukup sekali per perangkat. Konfigurasi + sesi pemilik disimpan di IndexedDB; saat aplikasi dibuka, `ensureCloudConnection()` memakai access token yang ada tanpa permintaan jaringan, atau memperbarui token lewat refresh token bila hampir kedaluwarsa. Realtime dan unggahan memakai sesi terbaru, jadi pemilik tidak perlu membuka panel pengaturan lagi. Hanya bila refresh token ditolak server (mis. sesi dicabut) aplikasi meminta masuk sekali lagi.
- **Metadata:** `public.outlet_snapshots` (id, outlet, skema, alasan, waktu, device, checksum, path, ukuran). Retry memakai `on_conflict=id` + `resolution=ignore-duplicates`, sehingga unggahan ulang tidak menggandakan baris. Snapshot dengan konten sama memakai path sama (checksum 12 karakter pertama).
- **Status:** ikon cloud di topbar menunjukkan `ok` (hijau), `gagal` (merah), atau nonaktif. Panel **Backup → Backup cloud** menampilkan transport, snapshot terakhir, dan pesan diagnostik.
- **Restore cloud:** unduh envelope → dekripsi → validasi lewat `inspectBackup()` yang sama dengan restore file lokal → pratinjau + konfirmasi sebelum menimpa data. File rusak, checksum tidak cocok, atau frasa sandi salah ditolak tanpa mengubah state. Di perangkat baru, masukkan frasa sandi yang sama; salt/iterasi diambil dari envelope.
- **Konfigurasi** disimpan di IndexedDB (`cloud:config`, `cloud:session`, `cloud:status`), bukan di backup JSON, sehingga token tidak ikut terunduh. Kata sandi akun tidak disimpan; hanya access/refresh token Supabase yang bisa diperbarui otomatis.

Langkah mengaktifkan: jalankan migration 003 (`bunx supabase db push`), buat user pemilik di Supabase Auth, lalu di aplikasi buka **Backup → Backup cloud**, isi URL project, anon key, UUID outlet, email + kata sandi pemilik, dan frasa sandi enkripsi. Setelah sesi tersambung, daftar snapshot aktif dan backup berjalan otomatis tanpa tombol manual.

Aktivasi hanya sekali per perangkat. Pada pembukaan berikutnya aplikasi memanggil `ensureCloudConnection()` saat boot, memverifikasi sesi tersimpan, memperbarui token bila perlu, dan menyalakan realtime tanpa membuka pengaturan; bila refresh token ditolak, panel menampilkan pesan agar pemilik masuk sekali lagi. URL/anon/outlet dari environment Vercel tetap hanya prefill — kata sandi dan frasa sandi tidak pernah masuk bundle.

**Belum diverifikasi pada turn ini:** unggahan ke project Supabase nyata (tidak ada kredensial), riwayat tujuh snapshot harian berturut-turut, dan restore cloud di browser bersih. Yang lulus adalah 71 pemeriksaan mock (`fetch` tiruan: enkripsi, checksum, auth, upload, metadata, retry, fallback, restore) serta 58 pemeriksaan database lokal dengan stub Storage (bucket privat + policy owner/kasir/lintas-outlet).

## Supabase Fase 3 (sinkronisasi dua arah, tetap offline-first)

Pull katalog berhalaman + pemicu realtime + push penjualan lewat RPC atomik. Kasir tetap membaca/menulis IndexedDB; sinkronisasi berjalan di latar belakang dan **tidak pernah** menahan transaksi.

### Database (`supabase/migrations/202610260004_sync_changes.sql`)

- `row_version` + `updated_at` pada `categories`, `menus`, `ingredients`, `outlet_settings`, dan `menu_recipes`; trigger BEFORE UPDATE menaikkan versi. Kolom `revision` warisan 001 tetap ada dan dinaikkan `touch_row`; versi otoritatif untuk sinkronisasi adalah `row_version`.
- `outlet_changes` diikutkan ke publikasi `supabase_realtime` lewat blok `do $$` terjaga — hanya jalan bila publikasi itu ada, jadi Postgres/PGlite biasa melewatinya — supaya `postgres_changes` benar-benar terkirim ke klien.
- `public.outlet_changes(seq identity primary key, outlet_id, entity, entity_id, op, row_version, payload, changed_at)` dengan index `(outlet_id, seq)`. Trigger AFTER INSERT/UPDATE/DELETE mencatat perubahan; soft delete (`deleted_at`) dicatat sebagai `op = 'delete'`. `seq` naik global sehingga urutannya juga monoton untuk setiap outlet.
- `pull_changes(p_outlet uuid, p_since_seq bigint, p_limit integer) returns jsonb` → `{ changes, next_seq, has_more, page_size }`, maksimum 500 baris per halaman, menolak non-member (`42501`).
- `apply_sale(p_payload jsonb) returns jsonb` → menerapkan transaksi + item secara atomik, idempoten per ID transaksi (`applied:false, duplicate:true` saat diulang), memvalidasi subtotal = jumlah item, dan menolak outlet yang bukan milik pemanggil.
- RLS: `outlet_changes` hanya `SELECT` untuk member outlet tersebut; tanpa grant tulis ke `authenticated` dan tanpa akses `anon`. `pull_changes`/`apply_sale` memakai `security definer` + cek membership, dan `EXECUTE` hanya diberikan ke `authenticated`.

### Klien (`src/lib/sync-client.ts`)

- **Pull berpaginasi**: `pullAllPages()` mengambil halaman sampai `has_more = false` (maks. 25 halaman per siklus). Kursor `seq` disimpan per outlet di IndexedDB key `sync:state` (`outlets[outletId].lastSeq`), bersama `appliedVersions` untuk deteksi replay.
- **Idempoten**: perubahan dengan `row_version <= versi yang sudah diterapkan` dilewati (dihitung `skippedChanges`), sehingga pull ulang atau kursor yang direset tidak menggandakan data.
- **Tombstone**: `op = 'delete'` menghapus kategori/menu/bahan dari katalog lokal dan memangkas baris resep yang menunjuk bahan terhapus.
- **Konflik (eksplisit)**: master data memakai last-write-wins berbasis `row_version` + urutan `seq`; baris dengan perubahan lokal tertunda tidak ditimpa dan dicatat ke `sync:conflicts` (maks. 50 entri terakhir, bisa dibaca di panel). Entitas ledger (transaksi/kas/shift/stok) tidak pernah ditimpa pull — dicatat sebagai konflik `tidak didukung`. Penghapusan `outlet_settings` ditolak.
- **Realtime sebagai pemicu**: `startRealtimeBridge()` join channel `outlet_changes` per outlet, pesan apa pun di-debounce ±1,5 detik lalu memicu satu pull. **Polling 60 detik tetap berjalan** sebagai fallback, termasuk saat websocket gagal/tertutup. Tidak ada perubahan data lewat websocket.
- **Push penjualan**: setiap transaksi baru masuk antrean lokal `sync:outbox`; dikirim lewat `apply_sale` (duplikat dianggap selesai), sisa antrean dipertahankan saat gagal bersama pesan error dan jumlah percobaan. Push berhenti lebih awal pada kegagalan auth/jaringan agar tidak menghantam server.
- **Tidak menahan kasir**: `enqueueSale()` + `pushOutboxQuietly()` dipanggil setelah transaksi tersimpan dan tidak pernah melempar ke alur jualan; `syncNow()` menangkap semua kegagalan dan hanya memperbarui status.
- **Kredensial**: tetap memakai sesi pemilik Fase 2 (`loadCloudSession`/refresh). Tidak ada login baru dan tidak ada service role key di klien. Isi yang dikirim tidak menambah plaintext baru: katalog dikirim server, penjualan dikirim sebagai payload RPC yang sudah ada di skema.

### UI

Panel **Backup → Sinkronisasi katalog** (bukan tab baru) menampilkan status (nonaktif/siap/menarik/mengirim/tersinkron/gagal), mode koneksi (realtime/polling), `seq` terakhir, waktu pull terakhir, jumlah perubahan tertunda, jumlah konflik, tombol **Sinkronkan sekarang**, dan daftar konflik terakhir. Ikon cloud di topbar ikut berubah merah saat sync gagal dan menampilkan badge jumlah antrean.

### Verifikasi lokal

- `bun run check:pull` — **44 pemeriksaan** dengan `fetch` + websocket tiruan: paginasi multi-halaman (`since_seq` maju, tanpa seq berulang), idempotensi replay, tombstone, LWW, penolakan konflik + log, pull gagal tidak mengubah store/kursor, outbox (payload, duplikat, retry, kegagalan auth), pemicu realtime + debounce, fallback polling, dan `stop()`.
- `bun run check:db` — **58 pemeriksaan** di Postgres lokal: trigger `row_version`/`outlet_changes`, urutan `seq`, paginasi + `has_more`, penolakan lintas-outlet dan anon untuk `pull_changes`/`apply_sale`, idempotensi `apply_sale`, penolakan subtotal salah, policy baca member, plus seed yang dijalankan ulang setelah semua migration dan kolom `row_version` yang terisi DEFAULT (bukan NULL).

**Hosted (2026-10-27):** migration 003 dan 004 sudah diterapkan ke project `sabana-pos` (wizard mendeteksi bucket/stream yang belum ada lalu menjalankannya sendiri). Jalur **apply** (`bun run supabase:hosted`, exit 0 — memuat `✔ Seed diterapkan` dan `✔ verify.sql lolos` setelah migration) dan **verify-only** (`bun run supabase:verify`, exit 0) sama-sama mencatat **48/48 pemeriksaan lolos**, termasuk `Policy RLS: 34 policy`, `Bucket backup privat`, dan `Stream sinkronisasi: outlet_changes + pull_changes + apply_sale + publikasi realtime siap`.

Sembilan pemeriksaan terakhir memanggil RPC di database hosted, bukan hanya memeriksa katalognya: `pull_changes` mengembalikan 2 baris + `has_more=true` lalu 1 baris tombstone (`op=delete`) dengan `seq` berurutan, `apply_sale` menerapkan penjualan lalu mengembalikan `duplicate:true` tanpa menggandakan baris, sedangkan pull lintas-outlet dan pull anon ditolak `42501`. Semua dipanggil sebagai peran `authenticated` di dalam satu transaksi yang diakhiri `rollback`; probe memverifikasi **0 baris sisa** setelahnya, jadi tidak ada data uji yang tertinggal di project.

**Belum diuji** walau begitu: handshake Realtime sungguhan dan pemanggilan `pull_changes`/`apply_sale` lewat klien di browser (sesi pemilik Fase 2), serta sinkronisasi dua perangkat. Catatan regresi: langkah seed pada run apply sempat gagal karena `jsonb_populate_recordset` + `select *` mengisi kolom NOT NULL baru (`row_version`, `updated_at` pada `menu_recipes`) dengan NULL; generator seed sekarang menyebut kolom secara eksplisit sehingga DEFAULT tabel dipakai, dan `check:db` menguji ulang seed setelah semua migration sebagai regresi.

## Angka dan aturan

- Kas seharusnya = float + penjualan cash + cash in − cash out.
- Penjualan cash dihitung dari `uang diterima − kembalian`.
- QRIS tidak menambah kas fisik.
- Pre-order diakui sebagai penjualan saat **Mulai proses**; pelunasan menjadi cash in.
- HPP dihitung dari resep dan harga bahan yang dapat diedit.

## Batasan saat ini

- Fase 3 (pull katalog + push penjualan) teruji dengan mock, dan RPC `pull_changes`/`apply_sale` sekarang **sudah dipanggil langsung di project hosted** (`supabase:verify` 48/48, transaksi probe di-rollback sehingga tidak meninggalkan data). Yang **belum** terbukti: handshake Realtime dari browser, jalur klien `sync-client.ts` terhadap project hosted, dan sinkronisasi dua perangkat. Kasir tetap membaca/menulis IndexedDB dan pull tidak pernah menimpa ledger.
- Push ke cloud masih terbatas pada **penjualan**. Perubahan katalog/bahan dari perangkat ini belum dikirim (menunggu fase berikutnya), sehingga pull memperlakukan perubahan lokal sebagai konflik yang dicatat, bukan ditimpa.
- Kategori bahan (`ingredientCategories`) dan pengaturan perangkat (nama printer, auto-print, PIN, tema) tetap lokal saja sesuai audit skema.
- Google Sheets belum terhubung; tersedia ekspor CSV sebagai jalur laporan.
- Build saat ini murni web; belum ada wrapper Capacitor/Android. Jalur native hanya aktif bila shell masa depan menyediakan `window.SabanaPrinter`.
- Cetak memakai Web Bluetooth untuk printer thermal **BLE** dan otomatis jatuh ke dialog print WebView/Android bila belum terhubung. Printer **Bluetooth Classic/SPP** memerlukan bridge native dan belum bisa dipakai langsung dari browser.
- Pairing Web Bluetooth bergantung pada browser (Chrome/Edge Android atau desktop, HTTPS/localhost) dan izin perangkat; pada WebView tanpa Web Bluetooth panel menampilkan transport **Dialog cetak sistem** dan tombol pairing dinonaktifkan.
- Belum ada verifikasi dengan printer fisik pada sesi ini; pengujian memakai mock BLE/native dan jsdom.
- Foto menu disimpan sebagai data URL di IndexedDB (maks. 560 px JPEG). Backup JSON memuat foto tersebut; untuk katalog sangat besar, kapasitas perangkat tetap perlu dipantau.
- Backup tersimpan di perangkat yang sama; unduh file JSON secara rutin untuk salinan di luar perangkat. Backup cloud/Google Drive otomatis belum ada.
- PIN memakai `crypto.subtle`; buka aplikasi lewat **HTTPS atau localhost**. Pada origin HTTP LAN biasa, PIN tidak bisa dibuat/diverifikasi (aplikasi menampilkan pesan; kasir tetap bisa berjualan, tetapi mode pemilik terkunci sampai origin aman dipakai).
- Capacitor, SQLite, dan sinkronisasi idempotent adalah tahap berikutnya sesuai rencana di `docs/superpowers/plans/`.
