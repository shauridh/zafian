"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useShiftStore } from "@/stores/shiftStore";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah, CASH_DENOMINATIONS } from "@/lib/format";
import Numpad from "@/components/ui/Numpad";

interface ShiftInfo {
  id: string;
  cashier_name: string;
  opened_at: string;
  opening_float: number;
  total_transactions: number;
  total_cash_sales: number;
  total_qris_sales: number;
  total_online_sales: number;
  total_all_sales: number;
}

export default function CloseShiftPage() {
  const router = useRouter();
  const { shiftId, cashierName, openingFloat, closeShift, isShiftOpen } = useShiftStore();

  const [counts, setCounts] = useState<Record<number, number>>(
    Object.fromEntries(CASH_DENOMINATIONS.map((d) => [d.value, 0]))
  );
  const [editingDenom, setEditingDenom] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [shiftInfo, setShiftInfo] = useState<ShiftInfo | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [now, setNow] = useState<Date | null>(null);

  // Real-time clock — mount on client to avoid hydration mismatch
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch real shift data from Supabase
  useEffect(() => {
    async function fetchShiftData() {
      if (!shiftId) {
        setLoadingData(false);
        return;
      }

      try {
        // Get shift info
        const { data: shift } = await supabase
          .from("shifts")
          .select("*")
          .eq("id", shiftId)
          .single();

        if (!shift) {
          setLoadingData(false);
          return;
        }

        // Get cashier name
        const { data: cashier } = await supabase
          .from("users")
          .select("name")
          .eq("id", shift.cashier_id)
          .single();

        // Get orders for this shift
        const { data: orders } = await supabase
          .from("orders")
          .select("id, payment_method, final_total, service_mode, created_at")
          .eq("shift_id", shiftId)
          .eq("status", "completed");

        const totalTransactions = orders?.length || 0;
        const totalCashSales = orders
          ?.filter((o) => o.payment_method === "cash")
          .reduce((sum, o) => sum + o.final_total, 0) || 0;
        const totalQrisSales = orders
          ?.filter((o) => o.payment_method === "qris")
          .reduce((sum, o) => sum + o.final_total, 0) || 0;
        const totalOnlineSales = orders
          ?.filter((o) => o.payment_method === "estimate")
          .reduce((sum, o) => sum + o.final_total, 0) || 0;

        setShiftInfo({
          id: shift.id,
          cashier_name: cashier?.name || cashierName || "Kasir",
          opened_at: shift.opened_at,
          opening_float: shift.opening_float || openingFloat || 350000,
          total_transactions: totalTransactions,
          total_cash_sales: totalCashSales,
          total_qris_sales: totalQrisSales,
          total_online_sales: totalOnlineSales,
          total_all_sales: totalCashSales + totalQrisSales + totalOnlineSales,
        });
      } catch (err) {
        console.error("Error fetching shift data:", err);
      } finally {
        setLoadingData(false);
      }
    }

    fetchShiftData();
  }, [shiftId, cashierName, openingFloat]);

  // Use real data or fallback to store values
  const data = useMemo(() => {
    if (!now) return {
      shiftId: shiftId || "—",
      cashierName: cashierName || "Kasir",
      openTime: "—",
      closeTime: "—",
      openDate: "—",
      totalTransactions: 0,
      totalCashSales: 0,
      totalQrisSales: 0,
      totalOnlineSales: 0,
      totalAllSales: 0,
      openingFloat: openingFloat || 350000,
    };
    return {
    shiftId: shiftInfo?.id || shiftId || "—",
    cashierName: shiftInfo?.cashier_name || cashierName || "Kasir",
    openTime: shiftInfo?.opened_at
      ? new Date(shiftInfo.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false })
      : "—",
    closeTime: now ? now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—",
    openDate: shiftInfo?.opened_at
      ? new Date(shiftInfo.opened_at).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : now ? now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "—",
    totalTransactions: shiftInfo?.total_transactions || 0,
    totalCashSales: shiftInfo?.total_cash_sales || 0,
    totalQrisSales: shiftInfo?.total_qris_sales || 0,
    totalOnlineSales: shiftInfo?.total_online_sales || 0,
    totalAllSales: shiftInfo?.total_all_sales || 0,
    openingFloat: shiftInfo?.opening_float || openingFloat || 350000,
  };
  }, [shiftInfo, shiftId, cashierName, openingFloat, now]);

  // Calculate actual cash from denomination counts
  const actualCash = useMemo(() => {
    return Object.entries(counts).reduce((sum, [denom, count]) => {
      return sum + Number(denom) * count;
    }, 0);
  }, [counts]);

  // Expected cash = opening float + cash sales only
  const expectedCash = data.openingFloat + data.totalCashSales;
  const cashDiff = actualCash - expectedCash;

  const handleCountChange = (denom: number, count: number) => {
    setCounts((prev) => ({ ...prev, [denom]: Math.max(0, count) }));
  };

  const handleCloseShift = async () => {
    setSaving(true);
    try {
      // Save reconciliation to Supabase
      if (shiftId) {
        await supabase
          .from("shifts")
          .update({
            status: "closed",
            closing_cash: actualCash,
            expected_cash: expectedCash,
            cash_diff: cashDiff,
            closed_at: new Date().toISOString(),
            notes: notes || null,
          })
          .eq("id", shiftId);

        // Save daily reconciliation
        await supabase.from("daily_reconciliation").insert({
          outlet_id: "00000000-0000-0000-0000-000000000001",
          shift_id: shiftId,
          total_sales_cash: data.totalCashSales,
          total_sales_qris: data.totalQrisSales,
          total_sales_online: data.totalOnlineSales,
          total_expenses: 0,
          total_income: data.totalAllSales,
          gross_profit: 0,
          opening_float: data.openingFloat,
          closing_cash: actualCash,
          cash_diff: cashDiff,
        });
      }

      closeShift();
      router.push("/kasir/shift/open");
    } catch (err) {
      console.error("Error closing shift:", err);
      closeShift();
      router.push("/kasir/shift/open");
    } finally {
      setSaving(false);
    }
  };

  if (loadingData) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-sabana border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">Memuat data shift...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto bg-danger rounded-2xl flex items-center justify-center text-3xl mb-3 shadow-lg">
            🔴
          </div>
          <h1 className="font-heading font-bold text-2xl text-gray-900 dark:text-gray-100">Tutup Kasir</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Hitung kas dan tutup shift hari ini</p>
        </div>

        {/* Shift Info */}
        <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm mb-4">
          <h3 className="font-heading font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-sabana-100 dark:bg-sabana/20 flex items-center justify-center text-sm">📋</span>
            Info Shift
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Kasir</span>
              <span className="font-medium">{data.cashierName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total Transaksi</span>
              <span className="font-medium">{data.totalTransactions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Tgl Buka</span>
              <span className="font-medium text-xs">{data.openDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Jam Tutup</span>
              <span className="font-mono font-bold text-sabana">{data.closeTime}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Modal Awal</span>
              <span className="font-bold">{formatRupiah(data.openingFloat)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Jam Buka</span>
              <span className="font-medium">{data.openTime}</span>
            </div>
          </div>

          {/* Sales Breakdown */}
          <div className="mt-4 pt-3 border-t space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">💵 Penjualan Tunai</span>
              <span className="font-bold text-sabana">{formatRupiah(data.totalCashSales)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">📱 Penjualan QRIS</span>
              <span className="font-bold text-blue-600">{formatRupiah(data.totalQrisSales)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">🛵 Penjualan Online</span>
              <span className="font-bold text-purple-600">{formatRupiah(data.totalOnlineSales)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="font-semibold">Total Semua Penjualan</span>
              <span className="font-bold text-lg">{formatRupiah(data.totalAllSales)}</span>
            </div>
          </div>
        </div>

        {/* Cash Counting */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
          <h3 className="font-heading font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-sabana-100 flex items-center justify-center text-sm">💵</span>
            Hitung Kas di Drawer
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            Tap nominal untuk mengisi jumlah lembar/koin yang ada di drawer.
          </p>

          {/* Visual cash total */}
          <div className="bg-gray-50 dark:bg-[#262626] rounded-xl p-4 text-center border border-gray-200 dark:border-[#333] mb-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Kas Aktual</p>
            <p className="text-3xl font-mono font-bold text-gray-900 dark:text-gray-100">
              {formatRupiah(actualCash)}
            </p>
          </div>

          <div className="space-y-2">
            {CASH_DENOMINATIONS.map((denom) => {
              const subtotal = denom.value * counts[denom.value];
              const isEditing = editingDenom === denom.value;

              return (
                <div key={denom.value}>
                  <div
                    className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                      isEditing
                        ? "bg-sabana-50 dark:bg-sabana/10 border-2 border-sabana"
                        : "bg-gray-50 dark:bg-[#262626] hover:bg-gray-100 dark:hover:bg-[#333] border-2 border-transparent"
                    }`}
                    onClick={() => setEditingDenom(isEditing ? null : denom.value)}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-16 text-center font-mono font-bold text-sm rounded-lg py-1.5 border ${
                        denom.value >= 10000
                          ? "bg-yellow-100 border-yellow-300 text-yellow-800"
                          : denom.value >= 1000
                          ? "bg-gray-100 border-gray-300 text-gray-700"
                          : "bg-amber-50 border-amber-200 text-amber-700"
                      }`}>
                        {denom.label}
                      </span>
                      <div>
                        <span className="text-sm text-gray-600">
                          × {counts[denom.value]} {denom.value >= 10000 ? "lembar" : "keping"}
                        </span>
                        {counts[denom.value] > 0 && (
                          <span className="text-xs text-gray-400 block">
                            {counts[denom.value]} × {formatRupiah(denom.value)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`font-bold text-sm ${subtotal > 0 ? "text-sabana" : "text-gray-400"}`}>
                      {formatRupiah(subtotal)}
                    </span>
                  </div>

                  {/* Inline quick count for editing */}
                  {isEditing && (
                    <div className="mt-2 p-3 bg-sabana-50 rounded-xl border border-sabana-100">
                      <div className="flex items-center gap-2 mb-2">
                        <label className="text-xs font-medium text-gray-600">Jumlah:</label>
                        <div className="w-20 rounded-lg border-2 border-gray-200 bg-white px-2 py-1.5 text-center font-mono text-lg font-bold">
                          {counts[denom.value]}
                        </div>
                        <span className="text-xs text-gray-500">
                          = {formatRupiah(subtotal)}
                        </span>
                      </div>
                      <Numpad
                        value={String(counts[denom.value])}
                        onChange={(value) => handleCountChange(denom.value, parseInt(value) || 0)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Reconciliation Summary */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
          <h3 className="font-heading font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-sabana-100 flex items-center justify-center text-sm">📊</span>
            Rekapitulasi
          </h3>

          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-500">Modal Awal</span>
              <span className="font-medium">{formatRupiah(data.openingFloat)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">+ Penjualan Tunai</span>
              <span className="font-medium text-success">+{formatRupiah(data.totalCashSales)}</span>
            </div>
            <div className="border-t pt-3 flex justify-between">
              <span className="font-semibold">Kas Expected (Harusnya)</span>
              <span className="font-bold text-lg">{formatRupiah(expectedCash)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold">Kas Aktual (Dihitung)</span>
              <span className="font-bold text-lg text-sabana">{formatRupiah(actualCash)}</span>
            </div>
            <div className={`border-t pt-3 flex justify-between p-3 rounded-xl ${
              actualCash === 0
                ? "bg-gray-50 border border-gray-200"
                : cashDiff === 0
                ? "bg-green-50 border border-green-200"
                : cashDiff > 0
                ? "bg-yellow-50 border border-yellow-200"
                : "bg-red-50 border border-red-200"
            }`}>
              <span className="font-bold">Selisih</span>
              <span className={`font-bold text-xl ${
                actualCash === 0
                  ? "text-gray-400"
                  : cashDiff === 0
                  ? "text-success"
                  : cashDiff > 0
                  ? "text-yellow-600"
                  : "text-danger"
              }`}>
                {actualCash === 0
                  ? "Belum dihitung"
                  : cashDiff === 0
                  ? "✅ Cocok"
                  : cashDiff > 0
                  ? `+${formatRupiah(cashDiff)} (Lebih)`
                  : `-${formatRupiah(Math.abs(cashDiff))} (Kurang)`}
              </span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm mb-4">
          <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">📝 Catatan (opsional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Catatan selisih, keluhan, dll..."
            rows={2}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] bg-white dark:bg-[#262626] text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sabana text-sm resize-none"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => router.push("/kasir")}
            className="px-6 py-4 rounded-2xl border-2 border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400
                       font-semibold hover:bg-gray-50 dark:hover:bg-[#333] active:scale-95 transition-all"
          >
            ← Kembali
          </button>
          <button
            onClick={handleCloseShift}
            disabled={saving || actualCash === 0}
            className="flex-1 py-4 rounded-2xl font-bold text-lg transition-all active:scale-95
                       bg-danger text-white shadow-lg shadow-danger/30 hover:bg-red-700
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Menyimpan...
              </span>
            ) : (
              "🔴 TUTUP SHIFT"
            )}
          </button>
        </div>

        {/* Warning if cash counting not done */}
        {actualCash === 0 && (
          <div className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 rounded-xl p-3 text-center mb-4">
            <p className="text-sm text-yellow-700 dark:text-yellow-400 font-medium">
              ⚠️ Hitung kas terlebih dahulu sebelum menutup shift
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
