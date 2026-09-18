"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { csvToObjects, downloadCsv } from "@/lib/csv";
import { formatRupiah } from "@/lib/format";

type Product = { id: string; name: string; sku?: string | null; price: number; hpp?: number | null; is_active: boolean };
type Ingredient = {
  id: string;
  name: string;
  sku?: string | null;
  purchase_price: number;
  unit: string;
  purchase_unit?: string | null;
  usage_unit?: string | null;
  conversion_factor?: number | null;
  is_active: boolean;
};
type BomLine = { ingredient_id: string; quantity: number; usage_unit: string };

const emptyLine = (): BomLine => ({ ingredient_id: "", quantity: 0, usage_unit: "" });

export default function RecipesPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [lines, setLines] = useState<BomLine[]>([emptyLine()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [bulkRows, setBulkRows] = useState<Record<string, string>[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);

  const selectedProduct = products.find((product) => product.id === selectedProductId);

  const ingredientById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [ingredients]
  );

  const hpp = useMemo(
    () => lines.reduce((total, line) => {
      const ingredient = ingredientById.get(line.ingredient_id);
      if (!ingredient || !line.quantity) return total;
      const factor = Number(ingredient.conversion_factor) || 1;
      return total + (Number(ingredient.purchase_price) / factor) * Number(line.quantity);
    }, 0),
    [ingredientById, lines]
  );

  const margin = (selectedProduct?.price || 0) - hpp;
  const marginPercent = selectedProduct?.price ? (margin / selectedProduct.price) * 100 : 0;

  async function loadBaseData() {
    setLoading(true);
    const [{ data: productData, error: productError }, { data: ingredientData, error: ingredientError }] = await Promise.all([
      supabase.from("products").select("id,name,price,hpp,is_active").eq("is_active", true).order("name"),
      supabase.from("ingredients").select("id,name,purchase_price,unit,purchase_unit,usage_unit,conversion_factor,is_active").eq("is_active", true).order("name"),
    ]);
    if (productError || ingredientError) {
      setMessage(productError?.message || ingredientError?.message || "Gagal memuat data.");
    } else {
      setProducts((productData || []) as Product[]);
      setIngredients((ingredientData || []) as Ingredient[]);
      if (!selectedProductId && productData?.[0]) setSelectedProductId(productData[0].id);
    }
    setLoading(false);
  }

  async function loadBom(productId: string) {
    if (!productId) {
      setLines([emptyLine()]);
      return;
    }
    const { data, error } = await supabase.from("product_ingredients").select("ingredient_id,quantity,usage_unit").eq("product_id", productId).order("id");
    if (error) {
      setMessage(error.message);
      return;
    }
    setLines(data?.length ? data.map((line) => ({
      ingredient_id: line.ingredient_id,
      quantity: Number(line.quantity),
      usage_unit: line.usage_unit || ingredientById.get(line.ingredient_id)?.usage_unit || ingredientById.get(line.ingredient_id)?.unit || "pcs",
    })) : [emptyLine()]);
  }

  useEffect(() => { void loadBaseData(); }, []);
  useEffect(() => { if (selectedProductId && ingredients.length) void loadBom(selectedProductId); }, [selectedProductId, ingredients.length]);

  function updateLine(index: number, patch: Partial<BomLine>) {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const next = { ...line, ...patch };
      if (patch.ingredient_id) {
        const ingredient = ingredientById.get(patch.ingredient_id);
        next.usage_unit = ingredient?.usage_unit || ingredient?.unit || "pcs";
      }
      return next;
    }));
  }

  async function importBomCsv(file: File | undefined) {
    if (!file) return;
    try {
      const rows = csvToObjects(await file.text());
      const required = ["product_sku", "product_name", "ingredient_sku", "ingredient_name", "quantity"];
      const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(rows[0] || {}, key));
      if (missing.length) throw new Error(`Kolom wajib belum ada: ${missing.join(", ")}`);
      setBulkRows(rows);
      setMessage(`${rows.length} baris BOM siap diimpor. Periksa preview lalu klik Import BOM.`);
    } catch (error) { setBulkRows([]); setMessage(error instanceof Error ? error.message : "CSV BOM tidak dapat dibaca."); }
  }

  async function saveBulkBom() {
    if (!bulkRows.length) return;
    setBulkSaving(true);
    try {
      const productMap = new Map(products.map((product) => [product.sku?.toLowerCase() || product.name.toLowerCase(), product]));
      const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.sku?.toLowerCase() || ingredient.name.toLowerCase(), ingredient]));
      const grouped = new Map<string, Array<{ ingredient_id: string; quantity: number; usage_unit: string }>>();
      bulkRows.forEach((row, index) => {
        const product = productMap.get((row.product_sku || row.product_name).toLowerCase());
        const ingredient = ingredientMap.get((row.ingredient_sku || row.ingredient_name).toLowerCase());
        const quantity = Number(row.quantity);
        if (!product || !ingredient || !quantity || quantity <= 0) throw new Error(`Baris ${index + 2}: produk/bahan tidak ditemukan atau quantity tidak valid.`);
        const key = product.id;
        const current = grouped.get(key) || [];
        current.push({ ingredient_id: ingredient.id, quantity, usage_unit: row.usage_unit || ingredient.usage_unit || ingredient.unit });
        grouped.set(key, current);
      });
      for (const [productId, bomLines] of Array.from(grouped.entries())) {
        const totalHpp = bomLines.reduce((total: number, line: { ingredient_id: string; quantity: number; usage_unit: string }) => { const ingredient = ingredients.find((item) => item.id === line.ingredient_id); return total + ((ingredient?.purchase_price || 0) / (Number(ingredient?.conversion_factor) || 1)) * line.quantity; }, 0);
        const { error: deleteError } = await supabase.from("product_ingredients").delete().eq("product_id", productId);
        if (deleteError) throw deleteError;
        const { error: insertError } = await supabase.from("product_ingredients").insert(bomLines.map((line) => ({ ...line, product_id: productId, cost_per_unit: Math.round((ingredients.find((item) => item.id === line.ingredient_id)?.purchase_price || 0) / (Number(ingredients.find((item) => item.id === line.ingredient_id)?.conversion_factor) || 1)) })));
        if (insertError) throw insertError;
        const { error: productError } = await supabase.from("products").update({ hpp: Math.round(totalHpp), cost_price: Math.round(totalHpp), updated_at: new Date().toISOString() }).eq("id", productId);
        if (productError) throw productError;
      }
      setBulkRows([]);
      setMessage(`${grouped.size} produk dan ${bulkRows.length} baris BOM berhasil diimpor.`);
      if (selectedProductId) await loadBom(selectedProductId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import BOM gagal."); }
    finally { setBulkSaving(false); }
  }

  async function saveBom(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProductId) return;
    const validLines = lines.filter((line) => line.ingredient_id && Number(line.quantity) > 0);
    setSaving(true);
    setMessage("");
    try {
      const { error: deleteError } = await supabase.from("product_ingredients").delete().eq("product_id", selectedProductId);
      if (deleteError) throw deleteError;
      if (validLines.length) {
        const { error: insertError } = await supabase.from("product_ingredients").insert(validLines.map((line) => ({
          product_id: selectedProductId,
          ingredient_id: line.ingredient_id,
          quantity: Number(line.quantity),
          usage_unit: line.usage_unit,
          cost_per_unit: Math.round((ingredientById.get(line.ingredient_id)?.purchase_price || 0) / (Number(ingredientById.get(line.ingredient_id)?.conversion_factor) || 1)),
        })));
        if (insertError) throw insertError;
      }
      const { error: productError } = await supabase.from("products").update({ hpp: Math.round(hpp), cost_price: Math.round(hpp), updated_at: new Date().toISOString() }).eq("id", selectedProductId);
      if (productError) throw productError;
      setProducts((current) => current.map((product) => product.id === selectedProductId ? { ...product, hpp: Math.round(hpp) } : product));
      setMessage("BOM tersimpan dan HPP produk diperbarui.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal menyimpan BOM.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Memuat resep dan bahan baku...</div>;

  return (
    <div className="p-6 space-y-5">
      <header>
        <h1 className="text-2xl font-heading font-bold text-gray-900">Resep / BOM</h1>
        <p className="text-gray-500 mt-1">Tentukan komposisi bahan per produk untuk menghitung HPP dan margin secara otomatis.</p>
      </header>

      {message && <div className={`rounded-xl border px-4 py-3 text-sm ${message.includes("tersimpan") || message.includes("berhasil") || message.includes("siap") ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}`}>{message}</div>}

      <section className="bg-sabana-50 rounded-2xl border border-sabana/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading font-semibold">Import BOM massal</h2><p className="text-xs text-gray-600 mt-1">CSV UTF-8. Produk dan bahan dicocokkan berdasarkan SKU, atau nama bila SKU kosong.</p></div><button type="button" onClick={() => downloadCsv("template-bom.csv", ["product_sku","product_name","ingredient_sku","ingredient_name","quantity","usage_unit"], [["AYM-DAD","Dada","ING-001","Tepung",125,"gram"]])} className="text-xs font-semibold text-sabana hover:underline">Download template</button></div>
        <div className="flex flex-wrap items-center gap-3 mt-4"><input type="file" accept=".csv,text/csv" onChange={(event) => void importBomCsv(event.target.files?.[0])} className="block text-sm" /><button type="button" onClick={() => void saveBulkBom()} disabled={!bulkRows.length || bulkSaving} className="px-4 py-2 rounded-xl bg-success text-white text-sm font-semibold disabled:opacity-50">{bulkSaving ? "Mengimpor..." : `Import BOM${bulkRows.length ? ` (${bulkRows.length})` : ""}`}</button></div>
        {bulkRows.length > 0 && <p className="text-xs text-gray-600 mt-3">Preview: {bulkRows.slice(0, 3).map((row) => `${row.product_name || row.product_sku} ← ${row.ingredient_name || row.ingredient_sku}`).join(" · ")}{bulkRows.length > 3 ? " …" : ""}</p>}
      </section>

      {!ingredients.length && <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">Belum ada bahan baku aktif. Isi bahan baku dan konversinya terlebih dahulu.</div>}

      <form onSubmit={saveBom} className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-heading font-semibold text-gray-900">Komposisi Produk</h2>
              <p className="text-xs text-gray-500 mt-1">Quantity diisi dalam satuan resep, bukan satuan beli.</p>
            </div>
            <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)} className="min-w-[220px] px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sabana">
              <option value="">Pilih produk</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </div>

          <div className="space-y-3">
            {lines.map((line, index) => {
              const ingredient = ingredientById.get(line.ingredient_id);
              const lineCost = ingredient ? (ingredient.purchase_price / (Number(ingredient.conversion_factor) || 1)) * (Number(line.quantity) || 0) : 0;
              return <div key={`${index}-${line.ingredient_id}`} className="grid grid-cols-[minmax(0,1fr)_110px_80px_34px] gap-2 items-end">
                <label className="text-xs text-gray-500">{index === 0 ? "Bahan baku" : ""}<select value={line.ingredient_id} onChange={(event) => updateLine(index, { ingredient_id: event.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sabana"><option value="">Pilih bahan</option>{ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label className="text-xs text-gray-500">{index === 0 ? "Qty resep" : ""}<input type="number" min="0" step="0.001" value={line.quantity || ""} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sabana" /></label>
                <div className="text-xs text-gray-500 pb-2.5">{line.usage_unit || ingredient?.usage_unit || ingredient?.unit || "—"}<div className="text-[10px] text-gray-400 mt-1">{formatRupiah(Math.round(lineCost))}</div></div>
                <button type="button" aria-label="Hapus bahan" onClick={() => setLines((current) => current.length === 1 ? [emptyLine()] : current.filter((_, lineIndex) => lineIndex !== index))} className="h-10 w-8 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">×</button>
              </div>;
            })}
          </div>
          <button type="button" onClick={() => setLines((current) => [...current, emptyLine()])} className="mt-4 text-sm font-semibold text-sabana hover:underline">+ Tambah bahan</button>
        </section>

        <aside className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 h-fit">
          <h2 className="font-heading font-semibold text-gray-900 mb-4">Ringkasan HPP</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Harga jual</span><strong>{formatRupiah(selectedProduct?.price || 0)}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">HPP bahan</span><strong className="text-danger">{formatRupiah(Math.round(hpp))}</strong></div>
            <div className="border-t border-gray-100 pt-3 flex justify-between"><span className="text-gray-500">Margin kotor</span><strong className={margin >= 0 ? "text-success" : "text-danger"}>{formatRupiah(Math.round(margin))}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">Margin %</span><strong className={marginPercent >= 0 ? "text-success" : "text-danger"}>{marginPercent.toFixed(1)}%</strong></div>
          </div>
          <button type="submit" disabled={!selectedProductId || saving} className="mt-6 w-full py-3 rounded-xl bg-sabana text-white font-bold hover:bg-sabana-dark disabled:opacity-50">{saving ? "Menyimpan..." : "Simpan BOM & HPP"}</button>
        </aside>
      </form>
    </div>
  );
}
