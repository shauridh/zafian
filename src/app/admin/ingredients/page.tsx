"use client";

import React, { useState } from "react";
import { useSupabaseCRUD } from "@/hooks/useSupabaseCRUD";
import { formatRupiah } from "@/lib/format";

interface Ingredient {
  id: string;
  name: string;
  sku?: string;
  unit: string;
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

  const [formData, setFormData] = useState({
    name: "", sku: "", unit: "pack", purchase_price: 0, stock_quantity: 0, min_stock: 0, supplier: "",
  });

  const resetForm = () => {
    setFormData({ name: "", sku: "", unit: "pack", purchase_price: 0, stock_quantity: 0, min_stock: 0, supplier: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...formData, is_active: true, purchase_price: Number(formData.purchase_price), stock_quantity: Number(formData.stock_quantity), min_stock: Number(formData.min_stock) };
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
    setFormData({ name: item.name, sku: item.sku || "", unit: item.unit, purchase_price: item.purchase_price, stock_quantity: item.stock_quantity, min_stock: item.min_stock, supplier: item.supplier || "" });
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-heading font-bold text-gray-900">📦 Bahan Baku</h1>
          <p className="text-gray-500 mt-1">Kelola bahan baku dan stok dari database</p>
        </div>
        <button onClick={() => { if (showForm) { resetForm(); } else { setEditingId(null); setShowForm(true); } }} className="px-4 py-2 bg-sabana text-white rounded-xl font-semibold hover:bg-sabana-dark transition-colors">
          + Tambah Bahan Baku
        </button>
      </div>

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
              <select value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana">
                <option value="pack">Pack</option>
                <option value="pouch">Pouch</option>
                <option value="kg">Kg</option>
                <option value="liter">Liter</option>
                <option value="pcs">Pcs</option>
                <option value="ekor">Ekor</option>
              </select>
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
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Nama</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">SKU</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Satuan</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Harga Beli</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Stok</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Min Stok</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Supplier</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ingredients.map((item) => {
                  const status = getStockStatus(item);
                  return (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-sm">{item.name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-500">{item.sku || "-"}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{item.unit}</td>
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
                  <tr><td colSpan={9} className="px-6 py-12 text-center text-gray-400">Belum ada bahan baku. Klik "Tambah Bahan Baku" untuk menambahkan.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
