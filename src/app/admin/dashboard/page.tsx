"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@//lib/supabase/client";
import { formatRupiah } from "@//lib/format";
import { useShiftStore } from "@/stores/shiftStore";
import ModalShell from "@/components/ui/ModalShell";

type TimeFilter = "today" | "week" | "month" | "year";

const TIME_FILTERS: { key: TimeFilter; label: string }[] = [
  { key: "today", label: "Hari Ini" },
  { key: "week", label: "Minggu Ini" },
  { key: "month", label: "Bulan Ini" },
  { key: "year", label: "Tahun Ini" },
];

// Busy hours data (default for "Hari Ini")
const BUSY_HOURS_MOCK = [
  { hour: "08", orders: 2, revenue: 180000 },
  { hour: "09", orders: 5, revenue: 450000 },
  { hour: "10", orders: 8, revenue: 720000 },
  { hour: "11", orders: 15, revenue: 1350000 },
  { hour: "12", orders: 22, revenue: 1980000 },
  { hour: "13", orders: 18, revenue: 1620000 },
  { hour: "14", orders: 12, revenue: 1080000 },
  { hour: "15", orders: 8, revenue: 720000 },
  { hour: "16", orders: 10, revenue: 900000 },
  { hour: "17", orders: 14, revenue: 1260000 },
  { hour: "18", orders: 20, revenue: 1800000 },
  { hour: "19", orders: 16, revenue: 1440000 },
  { hour: "20", orders: 10, revenue: 900000 },
  { hour: "21", orders: 6, revenue: 540000 },
  { hour: "22", orders: 3, revenue: 270000 },
];

const WEEKLY_SALES_MOCK = [
  { day: "Sen", value: 2800000 },
  { day: "Sel", value: 3100000 },
  { day: "Rab", value: 2900000 },
  { day: "Kam", value: 3400000 },
  { day: "Jum", value: 3800000 },
  { day: "Sab", value: 4200000 },
  { day: "Min", value: 3200000 },
];

const MONTHLY_SALES_MOCK = [
  { week: "M1", value: 18000000 },
  { week: "M2", value: 21000000 },
  { week: "M3", value: 19500000 },
  { week: "M4", value: 24000000 },
];

const YEARLY_SALES_MOCK = [
  { month: "Jan", value: 85000000 },
  { month: "Feb", value: 72000000 },
  { month: "Mar", value: 91000000 },
  { month: "Apr", value: 88000000 },
  { month: "Mei", value: 95000000 },
  { month: "Jun", value: 102000000 },
  { month: "Jul", value: 98000000 },
  { month: "Agu", value: 105000000 },
  { month: "Sep", value: 92000000 },
  { month: "Okt", value: 0 },
  { month: "Nov", value: 0 },
  { month: "Des", value: 0 },
];

export default function DashboardPage() {
  const router = useRouter();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("today");
  const [shiftInfo, setShiftInfo] = useState<any>(null);
  const [showPOSModal, setShowPOSModal] = useState(false);
  const [openingFloat, setOpeningFloat] = useState(350000);
  const [openingNotes, setOpeningNotes] = useState("");
  const { isShiftOpen, openShift } = useShiftStore();
  const [stats, setStats] = useState({ transactions: 0, revenue: 0, profit: 0, avgPerTx: 0 });
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [stockAlerts, setStockAlerts] = useState<any[]>([]);
  const [salesByPayment, setSalesByPayment] = useState<{ method: string; amount: number; pct: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, [timeFilter]);

  async function fetchDashboardData() {
    setLoading(true);
    try {
      // Date range based on filter
      const now = new Date();
      const startDate = new Date();
      if (timeFilter === "today") {
        startDate.setHours(0, 0, 0, 0);
      } else if (timeFilter === "week") {
        startDate.setDate(now.getDate() - now.getDay() + 1);
        startDate.setHours(0, 0, 0, 0);
      } else if (timeFilter === "month") {
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
      } else if (timeFilter === "year") {
        startDate.setMonth(0, 1);
        startDate.setHours(0, 0, 0, 0);
      }

      // Fetch orders
      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .gte("created_at", startDate.toISOString())
        .eq("status", "completed");

      const allOrders = orders || [];
      const totalRevenue = allOrders.reduce((sum: number, o: any) => sum + (o.total || 0), 0);
      const totalHPP = allOrders.reduce((sum: number, o: any) => sum + (o.hpp_total || 0), 0);

      setStats({
        transactions: allOrders.length,
        revenue: totalRevenue,
        profit: totalRevenue - totalHPP,
        avgPerTx: allOrders.length > 0 ? Math.round(totalRevenue / allOrders.length) : 0,
      });

      // Payment method breakdown
      const methodMap: Record<string, number> = {};
      allOrders.forEach((o: any) => {
        const m = o.payment_method || "Tunai";
        methodMap[m] = (methodMap[m] || 0) + (o.total || 0);
      });
      const methods = Object.entries(methodMap)
        .map(([method, amount]) => ({ method, amount, pct: totalRevenue > 0 ? Math.round((amount / totalRevenue) * 100) : 0 }))
        .sort((a, b) => b.amount - a.amount);
      setSalesByPayment(methods);

      // Recent orders
      const { data: recent } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
      setRecentOrders(recent || []);

      // Active shift
      const { data: shift } = await supabase
        .from("shifts")
        .select("*")
        .eq("status", "active")
        .order("opened_at", { ascending: false })
        .limit(1)
        .single();
      setShiftInfo(shift);

      // Stock alerts
      const { data: products } = await supabase
        .from("products")
        .select("name, stock_quantity, min_stock")
        .eq("is_active", true);
      
      const alerts = (products || [])
        .filter((p: any) => (p.stock_quantity || 0) <= (p.min_stock || 10))
        .map((p: any) => ({
          product: p.name,
          current: p.stock_quantity || 0,
          min: p.min_stock || 10,
          status: (p.stock_quantity || 0) === 0 ? "out" : "low",
        }))
        .sort((a: any, b: any) => a.current - b.current)
        .slice(0, 5);
      setStockAlerts(alerts);

    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }

  // Get chart data based on filter
  function getChartData() {
    if (timeFilter === "today") return { type: "busy_hours" as const, data: BUSY_HOURS_MOCK };
    if (timeFilter === "week") return { type: "bar" as const, data: WEEKLY_SALES_MOCK };
    if (timeFilter === "month") return { type: "bar" as const, data: MONTHLY_SALES_MOCK.map(d => ({ label: d.week, value: d.value })) };
    return { type: "bar" as const, data: YEARLY_SALES_MOCK.map(d => ({ label: d.month, value: d.value })) };
  }

  const chartData = getChartData();

  // Find peak hour
  const peakHour = BUSY_HOURS_MOCK.reduce((max, h) => h.orders > max.orders ? h : max, BUSY_HOURS_MOCK[0]);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 dark:text-gray-100">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-heading font-bold text-gray-900 dark:text-gray-100">
            📊 Dashboard
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {shiftInfo && ` — ${shiftInfo.id?.slice(0, 8)} (${shiftInfo.status === "active" ? "🟢 Aktif" : "🔴 Tutup"})`}
          </p>
        </div>
        <button
          onClick={() => {
            if (isShiftOpen) {
              router.push("/kasir");
            } else {
              setShowPOSModal(true);
            }
          }}
          className="flex items-center gap-2 px-5 py-3 bg-sabana text-white rounded-2xl font-bold hover:bg-sabana-dark transition-all shadow-lg shadow-sabana/30 active:scale-95"
        >
          <span className="text-xl">🍗</span>
          <span>Buka Kasir</span>
        </button>
      </div>

      {/* POS / Open Shift Modal */}
      {showPOSModal && (
        <ModalShell open={showPOSModal} onClose={() => setShowPOSModal(false)} className="max-w-sm">
          <div className="rounded-3xl p-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-sabana rounded-2xl flex items-center justify-center text-3xl mx-auto mb-3 shadow-lg">
                🍗
              </div>
              <h2 className="font-heading font-bold text-xl dark:text-gray-100">Buka Kasir</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Isi modal awal sebelum mulai transaksi</p>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Modal Awal (Rp)</label>
                <input
                  type="number"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-lg font-bold font-mono"
                />
                <div className="flex gap-2 mt-2">
                  {[100000, 200000, 350000, 500000].map((v) => (
                    <button
                      key={v}
                      onClick={() => setOpeningFloat(v)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                        openingFloat === v
                          ? "bg-sabana text-white"
                          : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {formatRupiah(v).replace("Rp", "")}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Catatan (opsional)</label>
                <input
                  type="text"
                  value={openingNotes}
                  onChange={(e) => setOpeningNotes(e.target.value)}
                  placeholder="Shift pagi, shift malam..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowPOSModal(false)}
                className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 font-semibold"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  openShift("30000000-0000-0000-0000-000000000001", "Sabana", openingFloat);
                  setShowPOSModal(false);
                  router.push("/kasir");
                }}
                className="flex-1 py-3 rounded-xl bg-sabana text-white font-bold hover:bg-sabana-dark transition-colors shadow-lg"
              >
                🟢 Buka Kasir
              </button>
            </div>
            </div>
        </ModalShell>
      )}

      {/* Time Filter Tabs */}
      <div className="flex gap-2">
        {TIME_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setTimeFilter(f.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              timeFilter === f.key
                ? "bg-sabana text-white shadow-md"
                : "bg-white dark:bg-[#1a1a1a] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-[#333] hover:border-sabana"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: "Transaksi", value: stats.transactions.toLocaleString("id-ID"), icon: "📊", color: "bg-blue-500", sub: `${timeFilter === "today" ? "hari ini" : timeFilter === "week" ? "minggu ini" : timeFilter === "month" ? "bulan ini" : "tahun ini"}` },
          { label: "Pendapatan", value: formatRupiah(stats.revenue), icon: "💰", color: "bg-success", sub: "" },
          { label: "Gross Profit", value: formatRupiah(stats.profit), icon: "📈", color: "bg-sabana", sub: stats.revenue > 0 ? `Margin ${Math.round((stats.profit / stats.revenue) * 100)}%` : "" },
          { label: "Rata-rata/Tx", value: formatRupiah(stats.avgPerTx), icon: "📋", color: "bg-purple-500", sub: "" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-4 border border-gray-100 dark:border-[#333] shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</p>
                <p className="text-lg md:text-xl font-heading font-bold text-gray-900 dark:text-gray-100 mt-1">
                  {loading ? <div className="w-16 h-5 bg-gray-200 dark:bg-[#333] rounded animate-pulse" /> : stat.value}
                </p>
                {stat.sub && <p className="text-xs text-success mt-0.5">{stat.sub}</p>}
              </div>
              <div className={`w-10 h-10 rounded-xl ${stat.color} flex items-center justify-center text-xl shrink-0`}>
                {stat.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Busy Hours / Sales Chart (main feature) */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-100 dark:border-[#333] shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-heading font-semibold text-gray-900 dark:text-gray-100">
              {timeFilter === "today" ? "🕐 Jam Ramai (Busy Hours)" : timeFilter === "week" ? "📈 Penjualan 7 Hari" : timeFilter === "month" ? "📈 Penjualan Bulan Ini" : "📈 Penjualan Tahun Ini"}
            </h3>
            {timeFilter === "today" && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                🔥 Puncak: <span className="text-sabana font-bold">{peakHour.hour}.00</span> — {peakHour.orders} pesanan ({formatRupiah(peakHour.revenue)})
              </p>
            )}
          </div>
        </div>

        {chartData.type === "busy_hours" ? (
          /* Busy Hours Chart - vertical bars with peak highlight */
          <div className="flex items-end gap-1 h-48 md:h-56">
            {BUSY_HOURS_MOCK.map((h) => {
              const maxOrders = Math.max(...BUSY_HOURS_MOCK.map((d) => d.orders));
              const height = maxOrders > 0 ? (h.orders / maxOrders) * 100 : 0;
              const isPeak = h.hour === peakHour.hour;
              const isHigh = h.orders >= maxOrders * 0.75;
              return (
                <div key={h.hour} className="flex-1 flex flex-col items-center gap-1 group relative">
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                    <div className="bg-gray-900 text-white text-[10px] rounded-lg px-2 py-1 whitespace-nowrap shadow-lg">
                      <div className="font-bold">{h.hour}.00 — {(parseInt(h.hour) + 1).toString().padStart(2, "0")}.00</div>
                      <div>{h.orders} pesanan</div>
                      <div>{formatRupiah(h.revenue)}</div>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 dark:text-gray-500">{h.orders > 0 ? h.orders : ""}</span>
                  <div
                    className={`w-full rounded-t-lg transition-all duration-500 ${
                      isPeak ? "bg-sabana shadow-lg shadow-sabana/30" : isHigh ? "bg-sabana/70" : "bg-sabana/30"
                    }`}
                    style={{ height: `${Math.max(height, 2)}%` }}
                  />
                  <span className={`text-[9px] font-medium ${isPeak ? "text-sabana font-bold" : "text-gray-400 dark:text-gray-500"}`}>
                    {h.hour}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          /* Bar chart for week/month/year */
          <div className="flex items-end gap-2 h-48 md:h-56">
            {chartData.data.map((d: any) => {
              const maxVal = Math.max(...(chartData.data as any[]).map((item: any) => item.value));
              const height = maxVal > 0 ? (d.value / maxVal) * 100 : 0;
              return (
                <div key={d.day || d.label} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatRupiah(d.value).replace("Rp", "")}</span>
                  <div className="w-full bg-sabana rounded-t-lg transition-all duration-500" style={{ height: `${Math.max(height, 2)}%` }} />
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{d.day || d.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Shift Info + Stock Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Shift Info */}
        <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-100 dark:border-[#333] shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-sabana-100 dark:bg-sabana/20 flex items-center justify-center">🔄</span>
            Info Shift
          </h3>
          {shiftInfo ? (
            <div className="space-y-3">
              {[
                { label: "Shift", value: shiftInfo.id?.slice(0, 8) || "-" },
                { label: "Kasir", value: shiftInfo.cashier_name || "-" },
                { label: "Jam Buka", value: shiftInfo.opened_at ? new Date(shiftInfo.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-" },
                { label: "Modal Awal", value: formatRupiah(shiftInfo.opening_float || 0) },
              ].map((item) => (
                <div key={item.label} className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400 text-sm">{item.label}</span>
                  <span className="font-medium text-sm text-gray-800 dark:text-gray-200">{item.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400 dark:text-gray-500">
              <p className="text-2xl mb-1">🔄</p>
              <p className="text-sm">Tidak ada shift aktif</p>
            </div>
          )}
        </div>

        {/* Stock Alerts */}
        <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-100 dark:border-[#333] shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">⚠️</span>
            Alert Stok
            {stockAlerts.length > 0 && (
              <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-danger text-xs font-bold rounded-full">{stockAlerts.length}</span>
            )}
          </h3>
          {stockAlerts.length > 0 ? (
            <div className="space-y-2">
              {stockAlerts.map((alert) => (
                <div key={alert.product} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-[#222]">
                  <div className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full ${alert.status === "out" ? "bg-danger" : "bg-warning"}`} />
                    <span className="font-medium text-sm text-gray-800 dark:text-gray-200">{alert.product}</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-bold ${alert.status === "out" ? "text-danger" : "text-yellow-600"}`}>
                      {alert.status === "out" ? "HABIS" : `Sisa ${alert.current}`}
                    </span>
                    <span className="text-xs text-gray-400 block">min: {alert.min}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400 dark:text-gray-500">
              <p className="text-2xl mb-1">✅</p>
              <p className="text-sm">Semua stok aman</p>
            </div>
          )}
        </div>
      </div>

      {/* Sales by Payment + Recent Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sales by Payment */}
        <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-100 dark:border-[#333] shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 dark:text-gray-100 mb-4">💳 Per Metode Bayar</h3>
          {salesByPayment.length > 0 ? (
            <div className="space-y-3">
              {salesByPayment.map((item) => (
                <div key={item.method} className="flex items-center gap-3">
                  <span className="text-sm w-28 text-gray-700 dark:text-gray-300">{item.method}</span>
                  <div className="flex-1 h-5 bg-gray-100 dark:bg-[#333] rounded-full overflow-hidden">
                    <div className="h-full bg-sabana rounded-full transition-all duration-500" style={{ width: `${item.pct}%` }} />
                  </div>
                  <span className="text-sm font-medium w-20 text-right text-gray-800 dark:text-gray-200">{formatRupiah(item.amount)}</span>
                  <span className="text-xs text-gray-400 w-10 text-right">{item.pct}%</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400 dark:text-gray-500">
              <p className="text-sm">Belum ada transaksi</p>
            </div>
          )}
        </div>

        {/* Recent Orders */}
        <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-100 dark:border-[#333] shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 dark:text-gray-100 mb-4">📋 Transaksi Terakhir</h3>
          <div className="space-y-2">
            {recentOrders.length > 0 ? recentOrders.map((order: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-[#222] transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                    {new Date(order.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="font-medium text-sm text-gray-800 dark:text-gray-200">{order.order_number || order.id?.slice(0, 8)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-sm text-gray-800 dark:text-gray-200">{formatRupiah(order.total || 0)}</span>
                  <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-gray-400">
                    {order.payment_method === "cash" ? "Tunai" : order.payment_method?.toUpperCase() || "Tunai"}
                  </span>
                  <span className="text-success text-xs">✓</span>
                </div>
              </div>
            )) : (
              <div className="text-center py-6 text-gray-400 dark:text-gray-500">
                <p className="text-sm">Belum ada transaksi</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
