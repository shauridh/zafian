"use client";

import React from "react";
import { formatRupiah } from "@/lib/format";

// Mock dashboard data
const STATS = [
  { label: "Transaksi Hari Ini", value: "42", change: "+12%", icon: "📊", color: "bg-blue-500" },
  { label: "Pendapatan", value: formatRupiah(3200000), change: "+8%", icon: "💰", color: "bg-success" },
  { label: "Gross Profit", value: formatRupiah(1100000), change: "+15%", icon: "📈", color: "bg-sabana" },
  { label: "Rata-rata/Transaksi", value: formatRupiah(76190), change: "+3%", icon: "📋", color: "bg-purple-500" },
];

const SHIFT_INFO = {
  shift: "#SH-0042",
  cashier: "Ahmad",
  openTime: "08:00",
  openingFloat: 350000,
  expectedCash: 1600000,
  status: "active",
};

const TOP_PRODUCTS = [
  { rank: 1, name: "Ayam Reguler (9 potong)", qty: 18, revenue: 1602000, pct: 56 },
  { rank: 2, name: "Nasi Putih", qty: 35, revenue: 175000, pct: 11 },
  { rank: 3, name: "Kentang Goreng", qty: 12, revenue: 96000, pct: 6 },
  { rank: 4, name: "Sambal Geprek", qty: 15, revenue: 60000, pct: 4 },
  { rank: 5, name: "Fruit Tea Apple", qty: 20, revenue: 60000, pct: 4 },
];

const RECENT_ORDERS = [
  { time: "14:32", id: "#DIN-0042", total: 195000, method: "Tunai", status: "completed" },
  { time: "14:28", id: "#DIN-0041", total: 89000, method: "QRIS", status: "completed" },
  { time: "14:15", id: "#TAW-0040", total: 52000, method: "Tunai", status: "completed" },
  { time: "14:02", id: "#GOF-0039", total: 115000, method: "GoFood", status: "completed" },
  { time: "13:45", id: "#DIN-0038", total: 95000, method: "Tunai", status: "completed" },
];

const STOCK_ALERTS = [
  { product: "Chicken Strip", current: 3, min: 10, status: "out" as const },
  { product: "Dada", current: 5, min: 10, status: "low" as const },
  { product: "Sayap", current: 3, min: 10, status: "low" as const },
  { product: "Paket Nasi Ayam", current: 0, min: 5, status: "out" as const },
];

// Weekly sales mock data
const WEEKLY_SALES = [
  { day: "Sen", value: 2800000 },
  { day: "Sel", value: 3100000 },
  { day: "Rab", value: 2900000 },
  { day: "Kam", value: 3400000 },
  { day: "Jum", value: 3800000 },
  { day: "Sab", value: 4200000 },
  { day: "Min", value: 3200000 },
];

const SALES_BY_PAYMENT = [
  { method: "💵 Tunai", amount: 1250000, pct: 39 },
  { method: "📱 QRIS", amount: 350000, pct: 11 },
  { method: "🛵 GoFood", amount: 200000, pct: 6 },
  { method: "🚚 GrabFood", amount: 150000, pct: 5 },
  { method: "🛒 ShopeeFood", amount: 100000, pct: 3 },
];

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-bold text-gray-900">
          📊 Dashboard
        </h1>
        <p className="text-gray-500 mt-1">
          {new Date().toLocaleDateString("id-ID", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })} — {SHIFT_INFO.shift} ({SHIFT_INFO.status === "active" ? "🟢 Aktif" : "🔴 Tutup"})
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-2xl font-heading font-bold text-gray-900 mt-1">
                  {stat.value}
                </p>
                <span className="inline-flex items-center text-xs font-medium text-success mt-1">
                  ▲ {stat.change} vs kemarin
                </span>
              </div>
              <div className={`w-12 h-12 rounded-xl ${stat.color} flex items-center justify-center text-2xl`}>
                {stat.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Shift Info + Stock Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Shift Info */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-sabana-100 flex items-center justify-center">🔄</span>
            Info Shift
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-500">Shift</span>
              <span className="font-medium">{SHIFT_INFO.shift}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Kasir</span>
              <span className="font-medium">{SHIFT_INFO.cashier}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Jam Buka</span>
              <span className="font-medium">{SHIFT_INFO.openTime}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Modal Awal</span>
              <span className="font-medium">{formatRupiah(SHIFT_INFO.openingFloat)}</span>
            </div>
            <div className="flex justify-between border-t pt-3">
              <span className="text-gray-500">Kas Expected</span>
              <span className="font-bold text-success">{formatRupiah(SHIFT_INFO.expectedCash)}</span>
            </div>
          </div>
        </div>

        {/* Stock Alerts */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-yellow-100 flex items-center justify-center">⚠️</span>
            Alert Stok
          </h3>
          <div className="space-y-3">
            {STOCK_ALERTS.map((alert) => (
              <div
                key={alert.product}
                className="flex items-center justify-between p-3 rounded-xl bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-3 h-3 rounded-full ${
                      alert.status === "out" ? "bg-danger" : "bg-warning"
                    }`}
                  />
                  <span className="font-medium text-sm">{alert.product}</span>
                </div>
                <div className="text-right">
                  <span
                    className={`text-sm font-bold ${
                      alert.status === "out" ? "text-danger" : "text-yellow-600"
                    }`}
                  >
                    {alert.status === "out" ? "HABIS" : `Sisa ${alert.current}`}
                  </span>
                  <span className="text-xs text-gray-400 block">min: {alert.min}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Weekly Sales Chart */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 mb-4">
            📈 Penjualan 7 Hari
          </h3>
          <div className="flex items-end gap-2 h-48">
            {WEEKLY_SALES.map((day) => {
              const maxVal = Math.max(...WEEKLY_SALES.map((d) => d.value));
              const height = (day.value / maxVal) * 100;
              return (
                <div key={day.day} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-gray-400">{formatRupiah(day.value).replace("Rp", "")}</span>
                  <div
                    className="w-full bg-sabana rounded-t-lg transition-all duration-500"
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-xs font-medium text-gray-500">{day.day}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sales by Payment Method */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 mb-4">
            💳 Per Metode Bayar
          </h3>
          <div className="space-y-3">
            {SALES_BY_PAYMENT.map((item) => (
              <div key={item.method} className="flex items-center gap-3">
                <span className="text-sm w-32">{item.method}</span>
                <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sabana rounded-full transition-all duration-500"
                    style={{ width: `${item.pct}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-24 text-right">{formatRupiah(item.amount)}</span>
                <span className="text-xs text-gray-400 w-10 text-right">{item.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Products + Recent Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top 5 Products */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 mb-4">
            🏆 Top 5 Produk Hari Ini
          </h3>
          <div className="space-y-3">
            {TOP_PRODUCTS.map((item) => (
              <div
                key={item.rank}
                className="flex items-center gap-3 p-3 rounded-xl bg-gray-50"
              >
                <span className="w-8 h-8 rounded-full bg-sabana text-white flex items-center justify-center text-sm font-bold">
                  {item.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{item.name}</p>
                  <p className="text-xs text-gray-400">{item.qty} terjual</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-sm text-sabana">{formatRupiah(item.revenue)}</p>
                  <p className="text-xs text-gray-400">{item.pct}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Orders */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 mb-4">
            📋 Transaksi Terakhir
          </h3>
          <div className="space-y-2">
            {RECENT_ORDERS.map((order, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400 font-mono">{order.time}</span>
                  <span className="font-medium text-sm">{order.id}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-sm">{formatRupiah(order.total)}</span>
                  <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                    {order.method}
                  </span>
                  <span className="text-success text-xs">✓</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
