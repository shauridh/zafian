"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah, formatDateTime } from "@/lib/format";

interface ShiftRecord {
  id: string;
  cashier_id: string;
  cashier_name: string;
  status: string;
  opening_float: number;
  closing_cash: number | null;
  expected_cash: number | null;
  cash_diff: number | null;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  total_orders: number;
  total_sales: number;
}

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "closed">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    fetchShifts();
  }, []);

  async function fetchShifts() {
    try {
      const { data: shiftData } = await supabase
        .from("shifts")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(100);

      if (!shiftData) { setLoading(false); return; }

      // Fetch cashier names and order counts
      const enriched = await Promise.all(
        shiftData.map(async (shift) => {
          // Cashier name
          const { data: cashier } = await supabase
            .from("users")
            .select("name")
            .eq("id", shift.cashier_id)
            .single();

          // Orders for this shift
          const { data: orders } = await supabase
            .from("orders")
            .select("final_total, payment_method")
            .eq("shift_id", shift.id)
            .eq("status", "completed");

          const totalOrders = orders?.length || 0;
          const totalSales = orders?.reduce((sum, o) => sum + o.final_total, 0) || 0;

          return {
            ...shift,
            cashier_name: cashier?.name || "Unknown",
            total_orders: totalOrders,
            total_sales: totalSales,
          };
        })
      );

      setShifts(enriched);
    } catch (err) {
      console.error("Error fetching shifts:", err);
    } finally {
      setLoading(false);
    }
  }

  // Filter
  const filteredShifts = shifts.filter((s) => {
    if (filter !== "all" && s.status !== filter) return false;
    if (dateFrom && new Date(s.opened_at) < new Date(dateFrom)) return false;
    if (dateTo) {
      const to = new Date(dateTo);
      to.setDate(to.getDate() + 1);
      if (new Date(s.opened_at) > to) return false;
    }
    return true;
  });

  // Stats
  const stats = {
    totalShifts: filteredShifts.length,
    activeShifts: filteredShifts.filter((s) => s.status === "active").length,
    totalSales: filteredShifts.reduce((sum, s) => sum + s.total_sales, 0),
    avgDiff: filteredShifts.filter((s) => s.cash_diff !== null).length > 0
      ? Math.round(filteredShifts.filter((s) => s.cash_diff !== null).reduce((sum, s) => sum + (s.cash_diff || 0), 0) / filteredShifts.filter((s) => s.cash_diff !== null).length)
      : 0,
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-heading font-bold text-gray-900">🔄 Riwayat Shift</h1>
          <p className="text-gray-500 text-sm mt-0.5">Semua shift yang pernah dibuka</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Total Shift", value: stats.totalShifts },
          { label: "Shift Aktif", value: stats.activeShifts, color: "text-success" },
          { label: "Total Penjualan", value: formatRupiah(stats.totalSales) },
          { label: "Rata-rata Selisih", value: formatRupiah(stats.avgDiff), color: stats.avgDiff === 0 ? "text-success" : "text-yellow-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-lg font-bold ${s.color || "text-gray-900"}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(["all", "active", "closed"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${filter === f ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
                {f === "all" ? "Semua" : f === "active" ? "🟢 Aktif" : "🔴 Tutup"}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sabana" />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sabana" />
          </div>
        </div>
      </div>

      {/* Shift List */}
      <div className="space-y-3">
        {filteredShifts.map((shift) => (
          <div key={shift.id} className={`bg-white rounded-xl p-4 border shadow-sm ${shift.status === "active" ? "border-green-200" : "border-gray-200"}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${shift.status === "active" ? "bg-success" : "bg-gray-400"}`}>
                  {shift.cashier_name.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{shift.cashier_name}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(shift.opened_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                    {shift.closed_at && ` — ${new Date(shift.closed_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`}
                  </p>
                </div>
              </div>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${shift.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                {shift.status === "active" ? "🟢 Aktif" : "🔴 Tutup"}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-500">Modal Awal</p>
                <p className="font-medium">{formatRupiah(shift.opening_float)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Transaksi</p>
                <p className="font-medium">{shift.total_orders} order</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Penjualan</p>
                <p className="font-bold text-sabana">{formatRupiah(shift.total_sales)}</p>
              </div>
              {shift.cash_diff !== null && (
                <div>
                  <p className="text-xs text-gray-500">Selisih</p>
                  <p className={`font-bold ${shift.cash_diff === 0 ? "text-success" : shift.cash_diff > 0 ? "text-yellow-600" : "text-danger"}`}>
                    {shift.cash_diff === 0 ? "✅ Cocok" : shift.cash_diff > 0 ? `+${formatRupiah(shift.cash_diff)}` : `-${formatRupiah(Math.abs(shift.cash_diff))}`}
                  </p>
                </div>
              )}
            </div>

            {shift.notes && (
              <p className="text-xs text-gray-400 mt-2 border-t pt-2">📝 {shift.notes}</p>
            )}
          </div>
        ))}

        {filteredShifts.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <span className="text-3xl block mb-2">🔄</span>
            <p className="text-sm">Tidak ada shift ditemukan</p>
          </div>
        )}
      </div>
    </div>
  );
}
