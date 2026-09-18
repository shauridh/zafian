"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";

const OUTLET_ID = "00000000-0000-0000-0000-000000000001";
type Row = { id: string; name: string; unit: string; supplier?: string; stock: number; suggested: number; price: number; selected: boolean };

export default function ReorderPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: ingredients }, { data: ledger }] = await Promise.all([
        supabase.from("ingredients").select("id,name,unit,purchase_price,supplier,stock_quantity,min_stock").eq("is_active", true).order("name"),
        supabase.from("stock_ledger").select("ingredient_id,quantity,created_at").eq("type", "production_out").gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()),
      ]);
      const usage = new Map<string, number>();
      (ledger || []).forEach((item: { ingredient_id: string; quantity: number }) => usage.set(item.ingredient_id, (usage.get(item.ingredient_id) || 0) + Math.abs(Number(item.quantity || 0))));
      setRows((ingredients || []).map((item: { id: string; name: string; unit: string; supplier?: string; purchase_price: number; stock_quantity: number; min_stock: number }) => {
        const avgDaily = (usage.get(item.id) || 0) / 30;
        const suggested = Math.max(0, Math.ceil(avgDaily * 14 + item.min_stock - item.stock_quantity));
        return { id: item.id, name: item.name, unit: item.unit, supplier: item.supplier, stock: item.stock_quantity, suggested, price: item.purchase_price, selected: suggested > 0 };
      }));
      setLoading(false);
    })();
  }, []);

  const selected = rows.filter((row) => row.selected && row.suggested > 0);
  const total = selected.reduce((sum, row) => sum + row.suggested * row.price, 0);
  const createDraft = async () => {
    if (!selected.length) return;
    setSaving(true);
    try {
      const { data: order, error } = await supabase.from("purchase_orders").insert({ outlet_id: OUTLET_ID, supplier: supplier || null, notes, total_estimate: total }).select("id").single();
      if (error || !order) throw error || new Error("Draft gagal dibuat");
      const { error: itemError } = await supabase.from("purchase_order_items").insert(selected.map((row) => ({ purchase_order_id: order.id, ingredient_id: row.id, quantity: row.suggested, unit_price: row.price })));
      if (itemError) throw itemError;
      alert(`Draft purchase order dibuat: ${order.id.slice(0, 8)}...`);
    } catch (error) { alert(error instanceof Error ? error.message : "Gagal membuat draft. Jalankan migration-phase-remaining.sql."); }
    finally { setSaving(false); }
  };

  return <div className="p-4 md:p-6 space-y-4"><div className="flex items-start justify-between"><div><h1 className="text-xl font-heading font-bold text-gray-900 dark:text-gray-100">🛒 Reorder Bahan Baku</h1><p className="text-sm text-gray-500 mt-1">Buat draft pembelian dari pemakaian 30 hari dan stok minimum.</p></div><span className="rounded-full bg-sabana-50 px-3 py-1 text-xs font-bold text-sabana">Estimasi {formatRupiah(total)}</span></div><div className="flex gap-2"><input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Supplier (opsional)" className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-[#444] dark:bg-[#222] dark:text-white" /><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Catatan pembelian" className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-[#444] dark:bg-[#222] dark:text-white" /><button onClick={() => void createDraft()} disabled={saving || !selected.length} className="rounded-xl bg-sabana px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "Menyimpan..." : "Buat Draft"}</button></div><div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-[#333] dark:bg-[#1a1a1a]"><table className="w-full text-sm"><thead><tr className="border-b border-gray-200 text-left text-xs text-gray-500"><th className="px-4 py-3">Pilih</th><th className="px-4 py-3">Bahan</th><th className="px-4 py-3 text-right">Stok</th><th className="px-4 py-3 text-right">Saran Beli</th><th className="px-4 py-3 text-right">Estimasi</th></tr></thead><tbody className="divide-y divide-gray-100">{loading ? <tr><td colSpan={5} className="p-8 text-center text-gray-500">Menghitung rekomendasi...</td></tr> : rows.map((row) => <tr key={row.id}><td className="px-4 py-2"><input type="checkbox" checked={row.selected} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, selected: event.target.checked } : item))} /></td><td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">{row.name}<span className="ml-2 text-xs text-gray-400">{row.unit}</span></td><td className="px-4 py-2 text-right">{row.stock}</td><td className="px-4 py-2 text-right"><input type="number" min="0" value={row.suggested} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, suggested: Math.max(0, Number(event.target.value) || 0) } : item))} className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-right dark:border-[#444] dark:bg-[#222] dark:text-white" /></td><td className="px-4 py-2 text-right font-semibold">{formatRupiah(row.suggested * row.price)}</td></tr>)}</tbody></table></div></div>;
}
