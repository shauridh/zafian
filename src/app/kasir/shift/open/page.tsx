"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useShiftStore } from "@/stores/shiftStore";
import { useUsers } from "@/hooks/useSupabaseData";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import Numpad from "@/components/ui/Numpad";

export default function OpenShiftPage() {
  const router = useRouter();
  const { openShift, isShiftOpen } = useShiftStore();
  const { users, loading } = useUsers();
  const [selectedCashier, setSelectedCashier] = useState<string | null>(null);
  const [floatInput, setFloatInput] = useState("350000");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  const cashiers = users.filter((u) => u.role === "cashier");
  const selectedCashierData = cashiers.find((c) => c.id === selectedCashier);
  const floatAmount = parseInt(floatInput) || 0;

  // Real-time clock — mount on client to avoid hydration mismatch
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // If shift already open, redirect to POS
  React.useEffect(() => {
    if (isShiftOpen) {
      router.push("/kasir");
    }
  }, [isShiftOpen, router]);

  const handleOpenShift = async () => {
    if (!selectedCashier) {
      setError("Pilih kasir terlebih dahulu");
      return;
    }
    if (floatAmount < 350000) {
      setError("Modal awal minimum Rp 350.000");
      return;
    }

    setSaving(true);
    setError("");

    try {
      // Save shift to Supabase
      const { data: shiftData, error: shiftError } = await supabase
        .from("shifts")
        .insert({
          outlet_id: "00000000-0000-0000-0000-000000000001",
          cashier_id: selectedCashier,
          status: "active",
          opening_float: floatAmount,
          opened_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (shiftError) throw shiftError;

      // Update local store
      openShift(selectedCashier, selectedCashierData?.name || "Kasir", floatAmount);

      // Store the Supabase shift ID
      if (shiftData) {
        useShiftStore.setState({ shiftId: shiftData.id });
      }

      router.push("/kasir");
    } catch (err: any) {
      console.error("Error opening shift:", err);
      // Still open shift locally even if Supabase fails
      openShift(selectedCashier, selectedCashierData?.name || "Kasir", floatAmount);
      router.push("/kasir");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto bg-sabana rounded-2xl flex items-center justify-center text-3xl mb-3 shadow-lg shadow-sabana/30">
            🍗
          </div>
          <h1 className="font-heading font-bold text-2xl text-sabana">Buka Kasir</h1>
          <p className="text-gray-500 text-sm mt-1">Isi modal awal sebelum mulai transaksi</p>
        </div>

        {/* Date & Time */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm mb-4 text-center">
          <p className="text-sm text-gray-500">Tanggal</p>
          <p className="font-semibold text-gray-900">
            {now ? now.toLocaleDateString("id-ID", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            }) : "—"}
          </p>
          <p className="text-sm text-gray-500 mt-1">Jam Buka</p>
          <p className="font-mono text-2xl font-bold text-sabana">
            {now ? now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—:—:—"}
          </p>
        </div>

        {/* Cashier Selection */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
          <h2 className="font-heading font-semibold text-gray-900 mb-3">👤 Pilih Kasir</h2>
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-6 h-6 border-2 border-sabana border-t-transparent rounded-full animate-spin" />
            </div>
          ) : cashiers.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">Tidak ada kasir ditemukan</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {cashiers.map((cashier) => (
                <button
                  key={cashier.id}
                  onClick={() => { setSelectedCashier(cashier.id); setError(""); }}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    selectedCashier === cashier.id
                      ? "border-sabana bg-sabana-50 shadow-md"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white ${
                    selectedCashier === cashier.id ? "bg-sabana" : "bg-gray-300"
                  }`}>
                    {cashier.name.charAt(0)}
                  </div>
                  <span className="font-medium text-sm">{cashier.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Float Amount */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
          <h2 className="font-heading font-semibold text-gray-900 mb-3">
            💵 Modal Awal (Float)
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Jumlah uang yang harus ada di drawer kas saat buka. Minimum Rp 350.000.
          </p>

          {/* Display */}
          <div className="bg-gray-50 rounded-xl p-4 text-center border border-gray-200 mb-4">
            <span className="text-3xl font-mono font-bold text-gray-900">
              Rp {floatAmount > 0 ? floatAmount.toLocaleString("id-ID") : "0"}
            </span>
          </div>

          {/* Numpad */}
          <Numpad
            value={floatInput}
            onChange={setFloatInput}
            showQuickAmounts
            quickAmounts={[
              { label: "350K", value: 350000 },
              { label: "500K", value: 500000 },
              { label: "1 JUTA", value: 1000000 },
              { label: "2 JUTA", value: 2000000 },
            ]}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-center">
            <p className="text-sm text-danger font-medium">⚠️ {error}</p>
          </div>
        )}

        {/* Open Shift Button */}
        <button
          onClick={handleOpenShift}
          disabled={saving || !selectedCashier}
          className="w-full py-4 bg-sabana text-white rounded-2xl font-bold text-lg
                     hover:bg-sabana-dark active:scale-95 transition-all shadow-lg shadow-sabana/30
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Membuka Kasir...
            </span>
          ) : (
            "✅ BUKA KASIR"
          )}
        </button>

        {/* Back to Login */}
        <button
          onClick={() => router.push("/login")}
          className="w-full py-3 mt-3 text-gray-500 font-medium hover:text-gray-700 transition-colors"
        >
          ← Kembali ke Login
        </button>
      </div>
    </div>
  );
}
