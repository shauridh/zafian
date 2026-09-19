"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { CASH_DENOMINATIONS, formatRupiah } from "@/lib/format";
import { useShiftStore } from "@/stores/shiftStore";
import Numpad from "@/components/ui/Numpad";
import ModalShell from "@/components/ui/ModalShell";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function CloseShiftModal({ isOpen, onClose }: Props) {
  const { shiftId, openingFloat, cashierName, closeShift } = useShiftStore();
  const [counts, setCounts] = useState<Record<number, number>>(() => Object.fromEntries(CASH_DENOMINATIONS.map((denom) => [denom.value, 0])));
  const [editingDenom, setEditingDenom] = useState<number | null>(null);
  const [cashSales, setCashSales] = useState(0);
  const [transactions, setTransactions] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !shiftId) return;
    let cancelled = false;
    void supabase.from("orders").select("payment_method, final_total").eq("shift_id", shiftId).eq("status", "completed").then(({ data }) => {
      if (cancelled) return;
      const orders = data || [];
      setTransactions(orders.length);
      setCashSales(orders.filter((order) => order.payment_method === "cash").reduce((sum, order) => sum + Number(order.final_total || 0), 0));
    });
    return () => { cancelled = true; };
  }, [isOpen, shiftId]);

  const actualCash = useMemo(() => Object.entries(counts).reduce((sum, [denom, count]) => sum + Number(denom) * count, 0), [counts]);
  const expectedCash = (openingFloat || 350000) + cashSales;
  const difference = actualCash - expectedCash;

  const updateCount = (denom: number, value: string) => {
    setCounts((current) => ({ ...current, [denom]: Math.max(0, Number.parseInt(value, 10) || 0) }));
  };

  const submit = async () => {
    if (!shiftId || actualCash <= 0) return;
    setSaving(true);
    try {
      await supabase.from("shifts").update({ status: "closed", closing_cash: actualCash, expected_cash: expectedCash, cash_diff: difference, closed_at: new Date().toISOString(), notes: notes || null }).eq("id", shiftId);
      await supabase.from("daily_reconciliation").insert({ outlet_id: "00000000-0000-0000-0000-000000000001", shift_id: shiftId, total_sales_cash: cashSales, total_sales_qris: 0, total_sales_online: 0, total_expenses: 0, total_income: cashSales, gross_profit: 0, opening_float: openingFloat || 350000, closing_cash: actualCash, cash_diff: difference });
      closeShift();
      onClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Gagal menutup shift");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell open={isOpen} onClose={onClose} className="max-w-[560px]">
      <div className="max-h-[calc(100dvh-32px)] overflow-y-auto bg-white p-4 dark:bg-[#1a1a1a] sm:p-5">
        <div className="mb-4 flex items-start justify-between">
          <div><h2 className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100">Tutup Kasir</h2><p className="text-xs text-gray-500">{cashierName || "Kasir"} · {transactions} transaksi · hitung kas aktual</p></div>
          <button type="button" onClick={onClose} aria-label="Tutup modal tutup kasir" className="min-h-10 min-w-10 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333]">✕</button>
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-gray-50 p-2 text-center dark:bg-[#262626]"><p className="text-[10px] text-gray-500">Modal awal</p><p className="text-xs font-bold">{formatRupiah(openingFloat || 350000)}</p></div>
          <div className="rounded-xl bg-gray-50 p-2 text-center dark:bg-[#262626]"><p className="text-[10px] text-gray-500">Penjualan tunai</p><p className="text-xs font-bold text-sabana">{formatRupiah(cashSales)}</p></div>
          <div className="rounded-xl bg-sabana-50 p-2 text-center dark:bg-sabana/10"><p className="text-[10px] text-gray-500">Kas aktual</p><p className="text-xs font-bold text-sabana">{formatRupiah(actualCash)}</p></div>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {CASH_DENOMINATIONS.map((denom) => {
            const subtotal = denom.value * counts[denom.value];
            const editing = editingDenom === denom.value;
            return <div key={denom.value} className="rounded-xl border border-gray-200 p-2 dark:border-[#444]">
              <button type="button" onClick={() => setEditingDenom(editing ? null : denom.value)} className="flex min-h-11 w-full items-center justify-between gap-2 text-left"><span><span className="block text-xs font-bold">{denom.label}</span><span className="text-[10px] text-gray-500">× {counts[denom.value]}</span></span><span className="text-xs font-semibold text-sabana">{formatRupiah(subtotal)}</span></button>
              {editing && <div className="mt-2"><Numpad value={String(counts[denom.value])} onChange={(value) => updateCount(denom.value, value)} /></div>}
            </div>;
          })}
        </div>
        <div className={`mb-3 flex items-center justify-between rounded-xl border p-3 ${actualCash === 0 ? "border-gray-200 bg-gray-50 dark:border-[#444] dark:bg-[#262626]" : difference === 0 ? "border-green-200 bg-green-50 dark:bg-green-900/20" : "border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20"}`}>
          <div><p className="text-xs font-semibold">Kas expected</p><p className="text-[10px] text-gray-500">Modal awal + penjualan tunai</p></div><div className="text-right"><p className="text-sm font-bold">{formatRupiah(expectedCash)}</p><p className="text-[10px] font-semibold">{actualCash === 0 ? "Belum dihitung" : difference === 0 ? "✅ Cocok" : `Selisih ${formatRupiah(difference)}`}</p></div>
        </div>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Catatan (opsional)" className="mb-3 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-[#444] dark:bg-[#262626]" />
        <div className="flex gap-2"><button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-600 dark:border-[#444] dark:text-gray-300">Batal</button><button type="button" onClick={() => void submit()} disabled={saving || actualCash <= 0} className="min-h-11 flex-1 rounded-xl bg-danger px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? "Menyimpan..." : "🔴 Tutup Shift"}</button></div>
      </div>
    </ModalShell>
  );
}
