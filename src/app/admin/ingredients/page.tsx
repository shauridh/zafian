"use client";

import React, { useRef, useState } from "react";
import { useSupabaseCRUD } from "@/hooks/useSupabaseCRUD";
import { csvToObjects, downloadCsv } from "@/lib/csv";
import { formatRupiah } from "@/lib/format";

interface Ingredient {
  id: string;
  name: string;
  sku?: string;
  unit: string;
  purchase_unit?: string;
  usage_unit?: string;
  conversion_factor?: number;
  purchase_price: number;
  stock_quantity: number;
  min_stock: number;
  supplier?: string;
  is_active: boolean;
  created_at: string;
}

export default function IngredientsPage() {
  const { data: ingredients, loading, create, update, remove } =
    useSupabaseCRUD<Ingredient>("ingredients", { orderBy: { column: "name", ascending: true } });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkRows, setBulkRows] = useState<Record<string, string>[]>([]);
  const [bulkError, setBulkError] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const bulkInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: "", sku: "", unit: "pack", purchase_unit: "pack", usage_unit: "gram", conversion_factor: 1, purchase_price: 0, stock_quantity: 0, min_stock: 0, supplier: "",
  });
  const [filters, setFilters] = useState({ name: "", sku: "", unit: "", status: "", supplier: "" });

  const resetForm = () => {
    setFormData({ name: "", sku: "", unit: "pack", purchase_unit: "pack", usage_unit: "gram", conversion_factor: 1, purchase_price: 0, stock_quantity: 0, min_stock: 0, supplier: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...formData, unit: formData.purchase_unit, is_active: true, purchase_unit: formData.purchase_unit, usage_unit: formData.usage_unit, conversion_factor: Number(formData.conversion_factor) || 1, purchase_price: Number(formData.purchase_price), stock_quantity: Number(formData.stock_quantity), min_stock: Number(formData.min_stock) };
      if (editingId) {
        await update(editingId, payload as any);
      } else {
        await create({ ...payload, created_at: new Date().toISOString() } as any);
      }
      resetForm();
    } catch (err: any) { alert("Error: " + err.message); } finally { setSaving(false); }
  };

  const handleEdit = (item: Ingredient) => {
    setEditingId(item.id);
    setFormData({ name: item.name, sku: item.sku || "", unit: item.unit, purchase_unit: item.purchase_unit || item.unit, usage_unit: item.usage_unit || item.unit, conversion_factor: item.conversion_factor || 1, purchase_price: item.purchase_price, stock_quantity: item.stock_quantity, min_stock: item.min_stock, supplier: item.supplier || "" });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus bahan baku ini?")) return;
    try { await remove(id); } catch (err: any) { alert("Error: " + err.message); }
  };

  const getStockStatus = (item: Ingredient) => {
    if (item.stock_quantity <= 0) return { label: "Habis", color: "bg-red-100 text-red-700" };
    if (item.stock_quantity <= item.min_stock) return { label: "Rendah", color: "bg-yellow-100 text-yellow-700" };
    return { label: "Cukup", color: "bg-green-100 text-green-700" };
  };

  const filteredIngredients = ingredients.filter((item) => {
    const status = getStockStatus(item).label.toLowerCase();
    return item.name.toLowerCase().includes(filters.name.toLowerCase())
      && (item.sku || "").toLowerCase().includes(filters.sku.toLowerCase())
      && `${item.purchase_unit || item.unit} ${item.usage_unit || item.unit}`.toLowerCase().includes(filters.unit.toLowerCase())
      && status.includes(filters.status.toLowerCase())
      && (item.supplier || "").toLowerCase().includes(filters.supplier.toLowerCase());
  });

  const handleBulkFile = async (file: File | undefined) => {
    if (!file) return;
    setBulkFile(file);
    setBulkError("");
    try {
      const rows = csvToObjects(await file.text());
      const required = ["name", "purchase_unit", "usage_unit", "conversion_factor", "purchase_price"];
      const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(rows[0] || {}, key));
      if (missing.length) throw new Error(`Kolom wajib belum ada: ${missing.join(", ")}`);
      if (!rows.length) throw new Error("File tidak memiliki baris data.");
      setBulkRows(rows);
    } catch (error) {
      setBulkRows([]);
      setBulkError(error instanceof Error ? error.message : "CSV tidak dapat dibaca.");
    }
  };

  const saveBulkIngredients = async () => {
    if (!bulkRows.length) return;
    setBulkSaving(true);
    setBulkError("");
    try {
      const payload = bulkRows.map((row, index) => {
        const conversion = Number(row.conversion_factor);
        const price = Number(row.purchase_price);
        if (!row.name || !row.purchase_unit || !row.usage_unit || !conversion || conversion <= 0 || Number.isNaN(price)) {
          throw new Error(`Baris ${index + 2} tidak valid. Periksa nama, satuan, konversi, dan harga beli.`);
        }
        return { name: row.name, sku: row.sku || null, unit: row.purchase_unit, purchase_unit: row.purchase_unit, usage_unit: row.usage_unit, conversion_factor: conversion, purchase_price: price, stock_quantity: Number(row.stock_quantity) || 0, min_stock: Number(row.min_stock) || 0, supplier: row.supplier || null, is_active: true };
      });
      const { error } = await (await import("@/lib/supabase/client")).supabase.from("ingredients").insert(payload);
      if (error) throw error;
      setBulkOpen(false);
      setBulkRows([]);
      setBulkFile(null);
      window.location.reload();
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Import bahan baku gagal.");
    } finally { setBulkSaving(false); }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-heading font-bold text-gray-900">📦 Bahan Baku</h1>
          <p className="text-gray-500 mt-1">Kelola bahan baku dan stok dari database</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setBulkOpen(!bulkOpen)} className="px-4 py-2 border border-sabana text-sabana rounded-xl font-semibold hover:bg-sabana-50 transition-colors">Import CSV</button>
          <button onClick={() => { if (showForm) { resetForm(); } else { setEditingId(null); setShowForm(true); } }} className="px-4 py-2 bg-sabana text-white rounded-xl font-semibold hover:bg-sabana-dark transition-colors">+ Tambah Bahan Baku</button>
        </div>
      </div>

      {bulkOpen && (
        <section className="bg-sabana-50 rounded-2xl p-5 border border-sabana/20 shadow-sm mb-6">
          <div className="flex items-start justify-between gap-4">
            <div><h3 className="font-heading font-semibold">Import bahan baku massal</h3><p className="text-xs text-gray-600 mt-1">Gunakan CSV UTF-8. Satu baris = satu bahan. Harga dan stok memakai satuan beli.</p></div>
            <button type="button" onClick={() => downloadCsv("template-bahan-baku.csv", ["name","sku","purchase_unit","usage_unit","conversion_factor","purchase_price","stock_quantity","min_stock","supplier"], [["Tepung","ING-001","kg","gram",1000,14000,0,0,"Supplier A"]])} className="text-xs font-semibold text-sabana hover:underline">Download template</button>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-4"><input ref={bulkInputRef} type="file" accept=".csv,text/csv" onChange={(event) => void handleBulkFile(event.target.files?.[0])} className="block text-sm" />{bulkFile && <span className="text-xs text-gray-500">{bulkFile.name} · {bulkRows.length} baris</span>}<button type="button" onClick={() => void saveBulkIngredients()} disabled={!bulkRows.length || bulkSaving} className="px-4 py-2 rounded-xl bg-success text-white text-sm font-semibold disabled:opacity-50">{bulkSaving ? "Mengimpor..." : "Import bahan"}</button></div>
          {bulkError && <p className="text-sm text-red-700 mt-3">{bulkError}</p>}
          {bulkRows.length > 0 && <p className="text-xs text-gray-600 mt-3">Preview valid: {bulkRows.slice(0, 3).map((row) => row.name).join(", ")}{bulkRows.length > 3 ? "…" : ""}</p>}
        </section>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm mb-6">
          <h3 className="font-heading font-semibold mb-4">{editingId ? "Edit Bahan Baku" : "Tambah Bahan Baku Baru"}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">Nama *</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">SKU</label>
              <input type="text" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Satuan *</label>
              <select value={formData.purchase_unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value, purchase_unit: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana">
                <option value="pack">Pack</option>
                <option value="pouch">Pouch</option>
                <option value="kg">Kg</option>
                <option value="liter">Liter</option>
                <option value="pcs">Pcs</option>
                <option value="ekor">Ekor</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Satuan Resep *</label>
              <select value={formData.usage_unit} onChange={(e) => setFormData({ ...formData, usage_unit: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana">
                <option value="gram">Gram</option><option value="kg">Kg</option><option value="ml">Ml</option><option value="liter">Liter</option><option value="pcs">Pcs</option><option value="ekor">Ekor</option><option value="porsi">Porsi</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Isi Konversi *</label>
              <input type="number" min="0.001" step="0.001" value={formData.conversion_factor} onChange={(e) => setFormData({ ...formData, conversion_factor: Number(e.target.value) })} required className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana font-mono" />
              <p className="text-[10px] text-gray-400 mt-1">1 {formData.purchase_unit} = {formData.conversion_factor || 0} {formData.usage_unit}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Harga Beli *</label>
              <input type="number" value={formData.purchase_price} onChange={(e) => setFormData({ ...formData, purchase_price: Number(e.target.value) })} required className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Stok</label>
              <input type="number" value={formData.stock_quantity} onChange={(e) => setFormData({ ...formData, stock_quantity: Number(e.target.value) })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Min Stok</label>
              <input type="number" value={formData.min_stock} onChange={(e) => setFormData({ ...formData, min_stock: Number(e.target.value) })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Supplier</label>
              <input type="text" value={formData.supplier} onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-6 py-2.5 bg-success text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50">
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
            <button type="button" onClick={resetForm} className="px-4 py-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">Batal</button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">Nama<input aria-label="Filter nama bahan baku" value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} placeholder="Cari nama" className="mt-1 w-full min-w-28 rounded-lg border border-gray-200 px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-sabana" /></th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">SKU<input aria-label="Filter SKU bahan baku" value={filters.sku} onChange={(e) => setFilters({ ...filters, sku: e.target.value })} placeholder="Cari SKU" className="mt-1 w-full min-w-24 rounded-lg border border-gray-200 px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-sabana" /></th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">Konversi<input aria-label="Filter satuan bahan baku" value={filters.unit} onChange={(e) => setFilters({ ...filters, unit: e.target.value })} placeholder="Satuan" className="mt-1 w-full min-w-24 rounded-lg border border-gray-200 px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-sabana" /></th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">HPP / Satuan Resep</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Harga Beli</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Stok</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Min Stok</th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">Status<input aria-label="Filter status stok bahan baku" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} placeholder="Cukup / habis" className="mt-1 w-full min-w-24 rounded-lg border border-gray-200 px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-sabana" /></th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">Supplier<input aria-label="Filter supplier bahan baku" value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })} placeholder="Cari supplier" className="mt-1 w-full min-w-24 rounded-lg border border-gray-200 px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-sabana" /></th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredIngredients.map((item) => {
                  const status = getStockStatus(item);
                  return (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-sm">{item.name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-500">{item.sku || "-"}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">1 {item.purchase_unit || item.unit} = {item.conversion_factor || 1} {item.usage_unit || item.unit}</td>
                      <td className="px-4 py-3 text-right text-sm font-mono">{formatRupiah(Math.round(item.purchase_price / (item.conversion_factor || 1)))}</td>
                      <td className="px-4 py-3 text-right text-sm font-mono">{formatRupiah(item.purchase_price)}</td>
                      <td className="px-4 py-3 text-right text-sm font-mono font-bold">{item.stock_quantity}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-500">{item.min_stock}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-1 rounded-full ${status.color}`}>{status.label}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.supplier || "-"}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleEdit(item)} className="px-2 py-1 text-xs rounded-lg hover:bg-gray-100">✏️</button>
                          <button onClick={() => handleDelete(item.id)} className="px-2 py-1 text-xs rounded-lg hover:bg-red-50 text-danger">🗑️</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {ingredients.length === 0 && (
                  <tr><td colSpan={10} className="px-6 py-12 text-center text-gray-400">Belum ada bahan baku. Klik "Tambah Bahan Baku" untuk menambahkan.</td></tr>
                )}
                {ingredients.length > 0 && filteredIngredients.length === 0 && (
                  <tr><td colSpan={10} className="px-6 py-10 text-center text-sm text-gray-400">Tidak ada bahan baku yang sesuai filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
