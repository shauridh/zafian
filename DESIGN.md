# DESIGN.md — Sabana POS

Dokumen ini mencatat apa yang **sudah** berlaku di kode, bukan cita-cita. Sumber kebenaran tetap `src/styles.css` dan komponen di `src/`.

## Kesan yang dituju

Kasir yang sibuk, tangan basah, tablet di counter. Prioritas: angka terbaca dari jarak satu meter, tombol tidak salah tekan, struk terlihat seperti struk. Paletnya kertas hangat + merah bata — bukan biru dashboard, bukan glassmorphism.

## Token warna

Didefinisikan di blok `@theme` (`src/styles.css:3`) dan ditimpa `.dark-theme`.

| Token | Terang | Gelap | Dipakai untuk |
|---|---|---|---|
| `--color-bg` | `#f7f4ef` | `#151210` | Latar halaman |
| `--color-surface` | `#fffdfb` | `#211b19` | Panel, kartu, modal |
| `--color-surface-2` | `#ffffff` | `#2a2421` | Kolom isian, panel dalam |
| `--color-raised` | `#f0e9e2` | `#332a26` | Tombol sekunder, thumb |
| `--color-line` | `rgb(75 50 42 / .12)` | `rgb(255 236 224 / .12)` | Garis pemisah |
| `--color-line-strong` | `rgb(75 50 42 / .2)` | `rgb(255 236 224 / .22)` | Border kontrol |
| `--color-fg` | `#25211e` | `#f3ede8` | Teks utama |
| `--color-muted` | `#5f5852` | `#c2b5ad` | Teks sekunder |
| `--color-faint` | `#675e57` | `#a89e97` | Metadata |
| `--color-accent` | `#c62828` | `#ff8a55` | Aksi utama, penanda |
| `--color-accent-2` | `#e53935` | `#ffc16e` | Gradien, aksen kedua |

**Aturan warna yang mengikat:**

- Jangan pernah menaruh aturan `color` global di atas selektor `:where(h1,h2,…,button)` — itu yang dulu mematikan token (dihapus pada audit 2026-10-30). Fallback warna untuk kontrol tanpa aturan sendiri ada di `@layer base`, sehingga selalu kalah dari aturan komponen.
- Teks putih hanya di atas `#a91d1d`–`#c62828` (≥5,6:1). Jangan kembali ke `#e53935` untuk label putih (4,23:1, gagal AA).
- Chip aktif memakai `#a51d24` + teks putih (7,5:1).
- Teks sekunder wajib ≥4,5:1 tanpa mengandalkan `opacity`.
- Angka uang diformat `toLocaleString('id-ID')` dengan awalan `Rp`; tidak ada pemisah manual.

## Tipografi

Font: Google Sans (400/500/600/700), fallback `ui-sans-serif, system-ui`.

**Lantai ukuran** — tidak ada teks UI di bawah 11px:

| Peran | Ukuran |
|---|---|
| Eyebrow / label kecil | 11px, letter-spacing .13em, uppercase |
| Metadata, catatan | 11–11,5px |
| Teks isi & label kolom | 12px |
| Baris tabel, nama menu | 12–13px |
| Angka uang di keranjang | 13px, tebal 700–800 |
| Judul panel | 18–23px |
| Angka total | 20–31px |

Struk memakai `ui-monospace` — itu bagian dari material cetak, bukan judul.

## Target sentuh

Minimum praktis **40px**, ideal **44px**. Nilai saat ini: tombol bayar 48, numpad 44, aksi dialog 44, stepper keranjang 40, tombol tutup dialog 40, aksi baris owner 34–38, chip kategori 36+.

Di bawah 900px, keranjang ditumpuk vertikal dan stepper tetap 40px (36px di ≤560px).

## Layout & responsif

- Kasir mengunci tinggi viewport (`100dvh` + fallback `100vh`), katalog dan keranjang menggulir sendiri supaya "Proses pesanan" tidak pernah keluar layar.
- `env(safe-area-inset-bottom)` dipakai di footer keranjang.
- Breakpoint: 1180 (keranjang 340px), 900 (tumpuk vertikal), 760 tinggi (mode lanskap padat), 620/560/420 (ponsel).
- Tabel lebar selalu dibungkus `overflow-x:auto`; tidak ada `min-width` yang memaksa halaman melebar.
- Target: nol overflow horizontal pada 1024×600, 1280×800, 800×1280, 360×640 (dijaga `check:ui`).

## Komponen inti

| Komponen | Berkas | Aturan |
|---|---|---|
| `Dialog` | `src/components/Dialog.tsx` | Semua modal kasir. `role="dialog"`, `aria-modal="true"`, nama aksesibel, fokus awal ke kolom isian pertama, Tab berputar di dalam, Escape menutup, fokus kembali ke pemicu, tombol tutup ber-`aria-label="Tutup"` |
| `Modal` / `ConfirmDialog` | `src/screens/owner/ui.tsx` | Varian owner, memakai hook fokus yang sama. `ConfirmDialog` menggantikan `window.confirm` (diblokir di WebView) |
| `Field` / `FieldGroup` | `src/screens/owner/ui.tsx` | Label membungkus kontrol; `FieldGroup` untuk grup tombol yang tidak boleh di dalam `<label>` |
| `MenuThumb` | `src/components/MenuThumb.tsx` | `loading="lazy"`, `object-fit:contain`, fallback emoji `aria-hidden` |
| `EmptyState` | `src/screens/owner/ui.tsx` | Ikon + judul + petunjuk + aksi opsional |

Kolom uang di dialog memakai `<label class="cash-field">` dengan `<span>` terlihat di atas input — placeholder tidak lagi satu-satunya label.

## Umpan balik & status

- Toast di layar kasir: `role="status" aria-live="polite"`, hilang setelah 3 detik, tidak menangkap klik.
- Validasi yang memblokir (uang kurang, alasan void kosong) memakai `role="alert"` di dalam dialog.
- Kegagalan penyimpanan muncul sebagai `.storage-alert` yang menetap sampai ditutup, dengan tombol "Coba lagi".
- Toast owner memakai `role="status"`.

## Gerak

Hanya `transform`, `opacity`, dan `color`. Durasi 0,15–0,2 detik. Tidak ada animasi layout. `prefers-reduced-motion: reduce` mematikan seluruh transisi/animasi.

## Nada tulisan

Bahasa Indonesia, kalimat kerja, istilah kasir nyata: "Proses pesanan", "Uang diterima", "Kembalian", "Tahan pesanan", "Tutup shift", "Float awal". Tanpa tanda seru, tanpa "Oops", tanpa emoji di teks UI (emoji hanya sebagai fallback gambar menu).

## Daftar periksa sebelum menambah UI

1. Warna dari token, bukan hex baru; kalau butuh hex, pastikan ≥4,5:1 di kedua tema.
2. Ukuran teks ≥11px, kontrol ≥40px.
3. Kontrol punya nama aksesibel; kalau ikon saja, `aria-label`.
4. Modal memakai `Dialog` / `Modal`, bukan `div.modal-backdrop` baru.
5. Uji di 360×640 dan 1024×600 sebelum menutup pekerjaan.
