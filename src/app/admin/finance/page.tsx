"use client";

import React, { useState } from "react";
import { formatRupiah } from "@/lib/format";

const INCOME_DATA = [
  { category: "💵 Penjualan Tunai", amount: 1250000, pct: 61 },
  { category: "📱 QRIS", amount: 350000, pct: 17 },
  { category: "🛵 GoFood", amount: 200000, pct: 10 },
  { category: "🚚 GrabFood", amount: 150000, pct: 7 },
  { category: "🛒 ShopeeFood", amount: 100000, pct: 5 },
];

const EXPENSE_DATA = [
  { category: "🏭 Produksi (Ayam)", amount: 480000 },
  { category: "📦 Bahan Baku Lainnya", amount: 150000 },
  { category: "🔧 Operasional", amount: 100000 },
  { category: "💡 Listrik", amount: 20000 },
  { category: "👷 Gaji Karyawan", amount: 1500000 },
  { category: "🏪 Sewa Kios", amount: 1500000 },
];

const TOTAL_INCOME = INCOME_DATA.reduce((sum, i) => sum + i.amount, 0);
const TOTAL_EXPENSE = EXPENSE_DATA.reduce((sum, e) => sum + e.amount, 0);
const OPENING_FLOAT = 350000;
const SALDO = OPENING_FLOAT + TOTAL_INCOME - TOTAL_EXPENSE;

export default function FinancePage() {
  const [showAddExpense, setShowAddExpense] = useState(false);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-gray-900">💰 Cashflow</h1>
          <p className="text-gray-500 mt-1">
            {new Date().toLocaleDateString("id-ID", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <button
          onClick={() => setShowAddExpense(!showAddExpense)}
          className="px-4 py-2 bg-sabana text-white rounded-xl font-semibold hover:bg-sabana-dark transition-colors"
        >
          + Tambah Pengeluaran
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm text-gray-500">Total Masuk</p>
          <p className="text-2xl font-heading font-bold text-success mt-1">
            +{formatRupiah(TOTAL_INCOME)}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm text-gray-500">Total Keluar</p>
          <p className="text-2xl font-heading font-bold text-danger mt-1">
            -{formatRupiah(TOTAL_EXPENSE)}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm text-gray-500">Saldo</p>
          <p className={`text-2xl font-heading font-bold mt-1 ${SALDO >= 0 ? "text-success" : "text-danger"}`}>
            {formatRupiah(SALDO)}
          </p>
        </div>
      </div>

      {/* Add Expense Form */}
      {showAddExpense && (
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <h3 className="font-heading font-semibold mb-4">Tambah Pengeluaran</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Kategori</label>
              <select className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana">
                <option>Bahan Baku</option>
                <option>Operasional</option>
                <option>Listrik</option>
                <option>Gaji</option>
                <option>Sewa</option>
                <option>Lainnya</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Deskripsi</label>
              <input
                type="text"
                placeholder="Deskripsi pengeluaran"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Jumlah</label>
              <input
                type="number"
                placeholder="Rp 0"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana font-mono"
              />
            </div>
            <div className="flex items-end gap-2">
              <button className="flex-1 px-4 py-2.5 bg-success text-white rounded-xl font-semibold hover:bg-green-700">
                Simpan
              </button>
              <button
                onClick={() => setShowAddExpense(false)}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Income */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="text-success text-xl">📈</span> Pemasukan
          </h3>
          <div className="space-y-3">
            {INCOME_DATA.map((item) => (
              <div key={item.category} className="flex items-center gap-3">
                <span className="text-sm flex-1">{item.category}</span>
                <div className="w-32 h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-success rounded-full"
                    style={{ width: `${item.pct}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-success w-28 text-right">
                  +{formatRupiah(item.amount)}
                </span>
              </div>
            ))}
            <div className="border-t pt-3 flex justify-between">
              <span className="font-semibold">TOTAL MASUK</span>
              <span className="font-bold text-success text-lg">+{formatRupiah(TOTAL_INCOME)}</span>
            </div>
          </div>
        </div>

        {/* Expenses */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="text-danger text-xl">📉</span> Pengeluaran
          </h3>
          <div className="space-y-3">
            {EXPENSE_DATA.map((item) => (
              <div key={item.category} className="flex items-center justify-between">
                <span className="text-sm">{item.category}</span>
                <span className="text-sm font-bold text-danger">-{formatRupiah(item.amount)}</span>
              </div>
            ))}
            <div className="border-t pt-3 flex justify-between">
              <span className="font-semibold">TOTAL KELUAR</span>
              <span className="font-bold text-danger text-lg">-{formatRupiah(TOTAL_EXPENSE)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Balance Summary */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
        <h3 className="font-heading font-semibold text-gray-900 mb-4">Ringkasan Saldo</h3>
        <div className="space-y-3 max-w-md">
          <div className="flex justify-between">
            <span className="text-gray-600">Saldo Awal (Modal Kas)</span>
            <span className="font-medium">{formatRupiah(OPENING_FLOAT)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">+ Total Masuk</span>
            <span className="font-medium text-success">+{formatRupiah(TOTAL_INCOME)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">- Total Keluar</span>
            <span className="font-medium text-danger">-{formatRupiah(TOTAL_EXPENSE)}</span>
          </div>
          <div className="border-t pt-3 flex justify-between">
            <span className="font-bold text-lg">Saldo Akhir</span>
            <span className={`font-bold text-2xl ${SALDO >= 0 ? "text-success" : "text-danger"}`}>
              {formatRupiah(SALDO)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
