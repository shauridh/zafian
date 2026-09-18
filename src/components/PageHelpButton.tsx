"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import ModalShell from "@/components/ui/ModalShell";

type HelpContent = { title: string; summary: string; steps: string[]; tip?: string };

const HELP: Record<string, HelpContent> = {
  "/kasir": { title: "Panduan Kasir", summary: "Gunakan POS untuk membuat pesanan, menerima pembayaran, dan mencetak struk.", steps: ["Pastikan shift sudah dibuka.", "Pilih mode layanan, kategori, lalu tekan produk untuk memasukkannya ke keranjang.", "Buka keranjang dan tekan BAYAR.", "Pilih Tunai/QRIS atau Estimasi untuk online food.", "Setelah berhasil, cetak/bagikan struk atau tekan Transaksi Baru."], tip: "Gunakan 💰 untuk Cash In/Out dan 📋 untuk melihat riwayat transaksi." },
  "/admin/dashboard": { title: "Panduan Dashboard", summary: "Ringkasan penjualan, omzet, HPP, margin, dan jam ramai outlet.", steps: ["Pilih rentang waktu pada filter.", "Gunakan grafik untuk membaca tren harian atau jam ramai.", "Klik kartu atau laporan lanjutan bila perlu melihat detail." ] },
  "/admin/products": { title: "Panduan Produk", summary: "Kelola menu yang tampil di kasir dan portal customer.", steps: ["Tambahkan nama, kategori, harga, SKU, dan satuan.", "Aktifkan/nonaktifkan produk dari daftar.", "Gunakan Paket/Bundling untuk membuat produk gabungan.", "Gunakan Resep/BOM untuk menghitung HPP produk." ] },
  "/admin/bundles": { title: "Panduan Paket/Bundling", summary: "Buat paket jual yang terdiri dari beberapa produk.", steps: ["Buat nama dan harga paket.", "Isi item yang termasuk di dalam paket.", "Aktifkan paket agar dapat digunakan di penjualan." ] },
  "/admin/menu": { title: "Panduan Kategori", summary: "Kelompokkan produk agar pencarian di POS dan portal lebih mudah.", steps: ["Buat atau edit nama kategori.", "Atur urutan dan status aktif.", "Produk pada kategori nonaktif tidak digunakan sebagai pilihan menu aktif." ] },
  "/admin/ingredients": { title: "Panduan Bahan Baku", summary: "Catat pembelian bahan dan konversi ke satuan yang dipakai resep.", steps: ["Masukkan harga dan satuan beli.", "Atur satuan resep serta isi konversi, contoh 1 kg = 1.000 gram.", "Gunakan HPP per satuan resep sebagai dasar BOM.", "Gunakan Import CSV untuk input banyak bahan sekaligus." ] },
  "/admin/recipes": { title: "Panduan Resep / BOM", summary: "Hubungkan bahan baku dengan produk untuk menghitung HPP dan margin.", steps: ["Pilih produk jual.", "Tambahkan bahan dan quantity dalam satuan resep.", "Simpan BOM untuk memperbarui HPP produk.", "Gunakan Import BOM untuk banyak produk sekaligus." ] },
  "/admin/production": { title: "Panduan Produksi", summary: "Konversikan bahan baku menjadi stok produk jadi menggunakan resep produksi.", steps: ["Tambahkan resep produksi dengan bahan input dan produk output.", "Pilih resep dan jumlah batch.", "Tekan Mulai Produksi.", "Stok produk jadi bertambah dan riwayat produksi tercatat." ], tip: "BOM menu dipakai menghitung HPP; resep produksi dipakai mengubah stok fisik." },
  "/admin/stock": { title: "Panduan Stok", summary: "Pantau stok produk jadi yang siap dijual di etalase.", steps: ["Bahan baku dikelola di halaman Bahan Baku.", "Produksi menambah stok produk jadi.", "Penjualan kasir mengurangi stok produk jadi.", "Gunakan Sesuaikan hanya untuk stok awal, rusak, atau koreksi opname." ] },
  "/admin/finance": { title: "Panduan Cashflow", summary: "Catat arus uang masuk dan keluar di luar transaksi penjualan.", steps: ["Pilih tipe pemasukan atau pengeluaran.", "Masukkan nominal, kategori, dan keterangan.", "Gunakan laporan untuk merekonsiliasi kas harian." ] },
  "/admin/reports": { title: "Panduan Laporan", summary: "Lihat ringkasan transaksi, HPP, margin, dan performa produk.", steps: ["Pilih periode laporan.", "Bandingkan omzet dengan HPP dan margin.", "Export data bila perlu untuk arsip." ] },
  "/admin/settings": { title: "Panduan Pengaturan", summary: "Atur outlet, tampilan, fitur operasional, printer, dan format struk.", steps: ["Simpan identitas outlet dan caption portal.", "Aktifkan fitur yang digunakan outlet.", "Uji printer dan periksa preview struk setelah mengubah format." ] },
  "/customer": { title: "Panduan Portal Customer", summary: "Customer dapat login dengan OTP, melihat loyalty, dan mengelola profil.", steps: ["Masukkan nomor WhatsApp dan verifikasi OTP.", "Gunakan Beranda untuk melihat greeting, poin, stamp, dan order.", "Gunakan Akun untuk mengubah nama, email, dan alamat.", "Gunakan Reward untuk melihat stamp dan benefit." ] },
  "/order": { title: "Panduan Order Online", summary: "Customer memilih menu, memasukkan data pengiriman, lalu mengirim pesanan ke kasir.", steps: ["Pilih kategori dan produk.", "Buka keranjang dan periksa jumlah.", "Isi nama, nomor HP, alamat, dan metode pembayaran.", "Kirim order dan tunggu kasir memprosesnya." ] },
  "/login": { title: "Panduan Login", summary: "Masuk ke aplikasi dengan PIN akun Sabana.", steps: ["Masukkan PIN 080802.", "Setelah login, buka dashboard.", "Pilih Buka Shift sebelum mengakses POS." ] },
};

const fallback: HelpContent = { title: "Panduan Halaman", summary: "Gunakan tombol aksi utama pada halaman ini untuk mengelola data.", steps: ["Baca ringkasan dan status data.", "Gunakan tombol Tambah untuk membuat data baru.", "Gunakan tombol Edit atau Aktif/Nonaktif untuk mengelola data.", "Simpan perubahan dan periksa pesan berhasil atau error."] };

export default function PageHelpButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const content = useMemo(() => HELP[pathname] || (pathname.startsWith("/admin") ? fallback : HELP["/kasir"]), [pathname]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Buka panduan: ${content.title}`} title="Buka panduan halaman" className="fixed bottom-[calc(env(safe-area-inset-bottom)+76px)] left-4 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-sm font-extrabold text-sabana shadow-lg transition-transform hover:scale-105 dark:border-[#444] dark:bg-[#1a1a1a]">?</button>
      <ModalShell open={open} onClose={() => setOpen(false)} className="max-w-md">
        <div className="max-h-[calc(100vh-32px)] overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-wider text-sabana">Info halaman</p><h2 className="mt-1 font-heading text-lg font-bold text-gray-900 dark:text-gray-100">{content.title}</h2></div><button type="button" onClick={() => setOpen(false)} aria-label="Tutup panduan" className="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333]">✕</button></div>
          <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{content.summary}</p>
          <ol className="mt-4 space-y-3">{content.steps.map((step, index) => <li key={step} className="flex gap-3 text-sm text-gray-700 dark:text-gray-200"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sabana-50 text-xs font-bold text-sabana dark:bg-sabana/15">{index + 1}</span><span className="pt-0.5">{step}</span></li>)}</ol>
          {content.tip && <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-200"><strong>Tips:</strong> {content.tip}</div>}
        </div>
      </ModalShell>
    </>
  );
}
