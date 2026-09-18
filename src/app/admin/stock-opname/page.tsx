"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import ModalShell from "@/components/ui/ModalShell";

const OUTLET_ID = "00000000-0000-0000-0000-000000000001";
type Row = { product_id: string; name: string; system: number; counted: number };

export default function StockOpnamePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: products }, { data: stock }] = await Promise.all([
        supabase.from("products").select("id,name").eq("is_active", true).order("name"),
        supabase.from("finished_goods").select("product_id,quantity").eq("outlet_id", OUTLET_ID),
      ]);
      const stockMap = new Map((stock || []).map((item: { product_id: string; quantity: number }) => [item.product_id, Number(item.quantity || 0)]));
      setRows((products || []).map((product: { id: string; name: string }) => {
        const quantity = stockMap.get(product.id) || 0;
        return { product_id: product.id, name: product.name, system: quantity, counted: quantity };
      }));
      setLoading(false);
    })();
  }, []);

  const differences = useMemo(() => rows.filter((row) => row.counted !== row.system), [rows]);
  const post = async () => {
    setPosting(true);
    try {
      const { data: opname, error } = await supabase.from("stock_opnames").insert({ outlet_id: OUTLET_ID, notes }).select("id").single();
      if (error || !opname) throw error || new Error("Opname gagal dibuat");
      const { error: itemError } = await supabase.from("stock_opname_items").insert(differences.map((row) => ({ opname_id: opname.id, product_id: row.product_id, system_quantity: row.system, counted_quantity: row.counted })));
      if (itemError) throw itemError;
      const { error: postError } = await supabase.rpc("post_stock_opname", { p_opname_id: opname.id, p_actor_id: null });
      if (postError) throw postError;
      setRows((current) => current.map((row) => ({ ...row, system: row.counted })));
      setNotes(""); setShowConfirm(false);
      alert("Opname berhasil diposting dan dicatat di ledger.");
    } catch (error) { alert(error instanceof Error ? error.message : "Gagal posting opname. Jalankan migration phase-1-5 terlebih dahulu."); }
    finally { setPosting(false); }
  };

  return <div className="p-4 md:p-6 space-y-4">
    <div className="flex items-start justify-between gap-3"><div><h1 className="text-xl font-heading font-bold text-gray-900 dark:text-gray-100">📋 Stock Opname</h1><p className="text-sm text-gray-500 mt-1">Bandingkan stok sistem dengan hitungan fisik, lalu posting selisih sebagai adjustment.</p></div><span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">{differences.length} selisih</span></div>
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-200">Flow: hitung fisik → isi kolom aktual → periksa selisih → posting sekali. Setiap perubahan masuk ke stock ledger dan audit log.</div>
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-[#333] dark:bg-[#1a1a1a]">
      {loading ? <p className="p-8 text-center text-sm text-gray-500">Memuat stok...</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-gray-200 text-left text-xs text-gray-500"><th className="px-4 py-3">Produk</th><th className="px-4 py-3 text-right">Sistem</th><th className="px-4 py-3 text-right">Aktual</th><th className="px-4 py-3 text-right">Selisih</th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row) => <tr key={row.product_id}><td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">{row.name}</td><td className="px-4 py-2 text-right text-gray-500">{row.system}</td><td className="px-4 py-2 text-right"><input type="number" min="0" value={row.counted} onChange={(event) => setRows((current) => current.map((item) => item.product_id === row.product_id ? { ...item, counted: Math.max(0, Number(event.target.value) || 0) } : item))} className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-right dark:border-[#444] dark:bg-[#222] dark:text-white" /></td><td className={`px-4 py-2 text-right font-bold ${row.counted - row.system < 0 ? "text-red-600" : row.counted - row.system > 0 ? "text-green-600" : "text-gray-400"}`}>{row.counted - row.system > 0 ? "+" : ""}{row.counted - row.system}</td></tr>)}</tbody></table></div>}
    </div>
    <div className="flex items-center gap-3"><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Catatan opname (opsional)" className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-[#444] dark:bg-[#222] dark:text-white" /><button disabled={!differences.length || posting} onClick={() => setShowConfirm(true)} className="rounded-xl bg-sabana px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Posting Opname</button></div>
    <ModalShell open={showConfirm} onClose={() => setShowConfirm(false)} className="max-w-sm"><div className="p-5"><h2 className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100">Konfirmasi posting</h2><p className="mt-2 text-sm text-gray-500">{differences.length} produk akan disesuaikan. Tindakan ini dicatat dan tidak boleh diulang.</p><div className="mt-4 flex gap-2"><button onClick={() => setShowConfirm(false)} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm">Batal</button><button onClick={() => void post()} disabled={posting} className="flex-1 rounded-xl bg-sabana py-2 text-sm font-bold text-white">{posting ? "Memposting..." : "Ya, Posting"}</button></div></div></ModalShell>
  </div>;
}
