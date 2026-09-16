"use client";

import React, { useState } from "react";
import { formatRupiah } from "@/lib/format";

const REPORT_DATA = {
  summary: {
    totalTransactions: 42,
    totalRevenue: 3200000,
    totalHpp: 2100000,
    grossProfit: 1100000,
    margin: 34.4,
    avgPerTransaction: 76190,
  },
  byCategory: [
    { name: "🍗 Ayam Goreng", amount: 1780000, pct: 56 },
    { name: "🍱 Rice Bowl", amount: 450000, pct: 14 },
    { name: "🍢 Side Menu", amount: 280000, pct: 9 },
    { name: "🍔 Burger & Bun", amount: 220000, pct: 7 },
    { name: "🥤 Minuman", amount: 200000, pct: 6 },
    { name: "🍚 Nasi", amount: 150000, pct: 5 },
    { name: "🥘 Sambal/Saus", amount: 120000, pct: 4 },
  ],
  byPayment: [
    { method: "💵 Tunai", amount: 1250000, pct: 39, count: 22 },
    { method: "📱 QRIS", amount: 350000, pct: 11, count: 8 },
    { method: "🛵 GoFood", amount: 200000, pct: 6, count: 4 },
    { method: "🚚 GrabFood", amount: 150000, pct: 5, count: 3 },
    { method: "🛒 ShopeeFood", amount: 100000, pct: 3, count: 2 },
  ],
  topProducts: [
    { name: "Ayam Reguler (9 potong)", qty: 18, revenue: 1602000, hpp: 1146780, margin: 455220 },
    { name: "Nasi Putih", qty: 35, revenue: 175000, hpp: 46665, margin: 128335 },
    { name: "Kentang Goreng", qty: 12, revenue: 96000, hpp: 80505, margin: 15495 },
    { name: "Sambal Geprek", qty: 15, revenue: 60000, hpp: 37230, margin: 22770 },
    { name: "Fruit Tea Apple", qty: 20, revenue: 60000, hpp: 50000, margin: 10000 },
  ],
};

export default function ReportsPage() {
  const [period, setPeriod] = useState("today");
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExportCSV = () => {
    // Generate CSV
    const csv = [
      "Laporan Harian - Sabana Fried Chicken",
      `Tanggal: ${new Date().toLocaleDateString("id-ID")}`,
      "",
      "Ringkasan",
      `Total Transaksi,${REPORT_DATA.summary.totalTransactions}`,
      `Total Pendapatan,${REPORT_DATA.summary.totalRevenue}`,
      `Total HPP,${REPORT_DATA.summary.totalHpp}`,
      `Gross Profit,${REPORT_DATA.summary.grossProfit}`,
      `Margin,${REPORT_DATA.summary.margin}%`,
      "",
      "Per Kategori",
      "Kategori,Jumlah,Persentase",
      ...REPORT_DATA.byCategory.map((c) => `${c.name},${c.amount},${c.pct}%`),
      "",
      "Top Produk",
      "Produk,Qty,Revenue,HPP,Margin",
      ...REPORT_DATA.topProducts.map(
        (p) => `${p.name},${p.qty},${p.revenue},${p.hpp},${p.margin}`
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      // Dynamic import for jsPDF
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();

      // Header
      doc.setFillColor(232, 109, 61);
      doc.rect(0, 0, pageWidth, 40, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("SABANA FRIED CHICKEN", pageWidth / 2, 18, { align: "center" });
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Laporan Penjualan - ${new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`, pageWidth / 2, 28, { align: "center" });

      // Summary Section
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Ringkasan", 14, 55);

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Total Transaksi: ${REPORT_DATA.summary.totalTransactions}`, 14, 65);
      doc.text(`Total Pendapatan: Rp ${REPORT_DATA.summary.totalRevenue.toLocaleString("id-ID")}`, 14, 73);
      doc.text(`Total HPP: Rp ${REPORT_DATA.summary.totalHpp.toLocaleString("id-ID")}`, 14, 81);
      doc.text(`Gross Profit: Rp ${REPORT_DATA.summary.grossProfit.toLocaleString("id-ID")}`, 14, 89);
      doc.text(`Margin: ${REPORT_DATA.summary.margin}%`, 14, 97);

      // Category Table
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Penjualan per Kategori", 14, 115);

      autoTable(doc, {
        startY: 120,
        head: [["Kategori", "Jumlah", "Persentase"]],
        body: REPORT_DATA.byCategory.map((c) => [
          c.name,
          `Rp ${c.amount.toLocaleString("id-ID")}`,
          `${c.pct}%`,
        ]),
        theme: "grid",
        headStyles: { fillColor: [232, 109, 61] },
      });

      // Top Products Table
      const finalY = (doc as any).lastAutoTable?.finalY || 180;
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Top 5 Produk", 14, finalY + 15);

      autoTable(doc, {
        startY: finalY + 20,
        head: [["#", "Produk", "Qty", "Revenue", "HPP", "Margin"]],
        body: REPORT_DATA.topProducts.map((p, i) => [
          `${i + 1}`,
          p.name,
          `${p.qty}`,
          `Rp ${p.revenue.toLocaleString("id-ID")}`,
          `Rp ${p.hpp.toLocaleString("id-ID")}`,
          `Rp ${p.margin.toLocaleString("id-ID")}`,
        ]),
        theme: "grid",
        headStyles: { fillColor: [232, 109, 61] },
      });

      // Footer
      const footerY = doc.internal.pageSize.getHeight() - 20;
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Dicetak pada ${new Date().toLocaleString("id-ID")} | Sabana POS - Sistem Manajemen Penjualan`,
        pageWidth / 2,
        footerY,
        { align: "center" }
      );

      // Save PDF
      doc.save(`Laporan-Sabana-${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (error) {
      console.error("PDF export error:", error);
      alert("Gagal export PDF. Silakan coba lagi.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-gray-900">📈 Laporan</h1>
          <p className="text-gray-500 mt-1">Laporan penjualan dan profit harian</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period Filter */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {["today", "week", "month"].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  period === p
                    ? "bg-white shadow text-gray-900"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {p === "today" ? "Hari Ini" : p === "week" ? "Minggu Ini" : "Bulan Ini"}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExportCSV}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
            >
              📊 CSV
            </button>
            <button
              onClick={handleExportPDF}
              disabled={exporting}
              className="px-4 py-2 bg-red-500 text-white rounded-xl font-semibold hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {exporting ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Exporting...
                </span>
              ) : (
                "📄 PDF"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm text-gray-500">Total Transaksi</p>
          <p className="text-2xl font-heading font-bold text-gray-900 mt-1">
            {REPORT_DATA.summary.totalTransactions}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm text-gray-500">Total Pendapatan</p>
          <p className="text-2xl font-heading font-bold text-sabana mt-1">
            {formatRupiah(REPORT_DATA.summary.totalRevenue)}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm text-gray-500">Total HPP</p>
          <p className="text-2xl font-heading font-bold text-danger mt-1">
            {formatRupiah(REPORT_DATA.summary.totalHpp)}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm text-gray-500">Gross Profit</p>
          <p className="text-2xl font-heading font-bold text-success mt-1">
            {formatRupiah(REPORT_DATA.summary.grossProfit)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Margin: {REPORT_DATA.summary.margin}%</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Category */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 mb-4">Per Kategori</h3>
          <div className="space-y-3">
            {REPORT_DATA.byCategory.map((cat) => (
              <div key={cat.name} className="flex items-center gap-3">
                <span className="text-sm flex-1">{cat.name}</span>
                <div className="w-32 h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sabana rounded-full"
                    style={{ width: `${cat.pct}%` }}
                  />
                </div>
                <span className="text-sm font-bold w-28 text-right">{formatRupiah(cat.amount)}</span>
                <span className="text-xs text-gray-400 w-10 text-right">{cat.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* By Payment Method */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 mb-4">Per Metode Bayar</h3>
          <div className="space-y-3">
            {REPORT_DATA.byPayment.map((item) => (
              <div key={item.method} className="flex items-center gap-3">
                <span className="text-sm flex-1">{item.method}</span>
                <span className="text-xs text-gray-400">{item.count} tx</span>
                <span className="text-sm font-bold w-28 text-right">{formatRupiah(item.amount)}</span>
                <span className="text-xs text-gray-400 w-10 text-right">{item.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Products with Profit Analysis */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
        <h3 className="font-heading font-semibold text-gray-900 mb-4">🏆 Top 5 Produk + Analisis Profit</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">#</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Produk</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Qty</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Revenue</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">HPP</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {REPORT_DATA.topProducts.map((product, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="w-7 h-7 rounded-full bg-sabana text-white flex items-center justify-center text-xs font-bold">
                      {idx + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{product.name}</td>
                  <td className="px-4 py-3 text-right">{product.qty}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatRupiah(product.revenue)}</td>
                  <td className="px-4 py-3 text-right text-danger">{formatRupiah(product.hpp)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-bold ${product.margin > 0 ? "text-success" : "text-danger"}`}>
                      {formatRupiah(product.margin)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
