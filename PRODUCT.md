# Sabana POS

Aplikasi kasir (POS) untuk satu outlet FnB kecil — warung, kedai, kafe, atau dapur pesanan. Dibuka di tablet atau ponsel Android yang berdiri di depan kasir.

## Siapa yang memakainya

| Peran | Akses | Yang dikerjakan |
|---|---|---|
| Kasir | Langsung | Buka shift, pilih menu, proses pesanan, terima tunai/QRIS, cetak struk, tahan pesanan, catat kas masuk/keluar |
| Pemilik | Langsung lewat avatar P (tanpa PIN) | Semua di atas, plus menu & HPP, kategori, bahan & stok, forecast, laporan, pengaturan printer, backup, void |

Void, tutup shift, dan pengaturan langsung terbuka tanpa PIN; aplikasi ini dipakai pemilik tunggal per outlet.

## Dua mode data

- **Lokal** — tanpa `VITE_SUPABASE_URL`/`ANON_KEY`. State disimpan di IndexedDB (`sabana-pos`) lewat `src/lib/persistence.ts`, dengan migrasi sekali dari kunci `localStorage` lama `sabana-pos-store-v1`. Katalog contoh hanya di-seed di mode ini.
- **Online** — dengan env Supabase. Wajib login; Supabase adalah sumber kebenaran dan `src/lib/online.ts` menggabungkan penulisan (debounce 350 ms) lalu mengirim snapshot. Tidak ada antrean offline: kegagalan jaringan ditolak dan ditampilkan sebagai alert, bukan ditelan.

## Alur utama

1. **Buka shift** — float awal (default Rp350.000) + catatan pembukaan; keduanya masuk ke audit log.
2. **Pesan** — kategori, katalog (foto/emoji), tipe pesanan (Takeaway, Dine in, GoFood, GrabFood, ShopeeFood). Kanal delivery dicatat `Unpaid` tanpa pembayaran di aplikasi.
3. **Bayar** — tunai (numpad, uang pas, kembalian, validasi uang kurang) atau QRIS. Tombol bayar terkunci bila uang tunai di bawah total.
4. **Struk** — pratinjau struk, cetak ke printer thermal (Web Serial/native bridge) atau bagikan; auto-print mengikuti pengaturan.
5. **Selingan** — tahan pesanan, pre-order + DP (penjualan diakui saat mulai diproses, pelunasan tunai jadi cash movement).
6. **Tutup shift** — backup otomatis sebelum menutup, kas aktual, setoran ke owner, selisih terhadap kas seharusnya.
7. **Pemilik** — opname stok, resep/HPP, forecast bahan, laporan laba-rugi + neraca, backup/restore, audit log.

## Batasan yang disengaja

- Satu outlet per akun; tidak ada multi-cabang atau peran staf berjenjang.
- Tidak ada pembayaran online, integrasi marketplace, atau sinkronisasi dua arah saat offline.
- Tidak ada lintas-perangkat realtime; perangkat lain baru melihat data setelah memuat ulang.

## Verifikasi

```bash
bun run typecheck          # tsc --noEmit
bun run build              # vite build + postbuild (PWA precache)
bun run check:domain       # aturan domain & printer
bun run check:runtime      # mount App di jsdom, jalankan alur kasir & owner
bun run check:storage      # IndexedDB/localStorage, migrasi, kegagalan tulis
bun run check:repo         # gateway Supabase (mock), RLS, pesan error
bun run check:ui           # Chromium headless: alur kasir + overflow 1024x600..360x640
bun run check:sql          # PGlite: skema & RLS (butuh lib lokal, bukan database produksi)
```
