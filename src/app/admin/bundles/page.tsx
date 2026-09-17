"use client";

import React, { useState } from "react";
import { useSupabaseCRUD } from "@/hooks/useSupabaseCRUD";
import { formatRupiah } from "@/lib/format";

interface Bundle {
  id: string;
  name: string;
  description?: string;
  price: number;
  items?: string;
  is_active: boolean;
  created_at?: string;
}

export default function BundlesPage() {
  const { data: bundles, loading, create, update, remove, refresh } =
    useSupabaseCRUD<Bundle>("bundles", { orderBy: { column: "name", ascending: true } });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    price: 0,
    items: "",
    is_active: true,
  });

  const resetForm = () => {
    setFormData({ name: "", description: "", price: 0, items: "", is_active: true });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...formData,
        price: Number(formData.price),
        updated_at: new Date().toISOString(),
      };
      if (editingId) {
        await update(editingId, payload as any);
      } else {
        await create({ ...payload, created_at: new Date().toISOString() } as any);
      }
      resetForm();
      refresh();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (bundle: Bundle) => {
    setEditingId(bundle.id);
    setFormData({
      name: bundle.name,
      description: bundle.description || "",
      price: bundle.price,
      items: bundle.items || "",
      is_active: bundle.is_active,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus paket ini?")) return;
    try { await remove(id); } catch (err: any) { alert("Error: " + err.message); }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-heading font-bold text-gray-900 dark:text-gray-100">🎁 Paket/Bundling</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Kelola paket bundling produk dari database</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); resetForm(); }} className="px-4 py-2 bg-sabana text-white rounded-xl font-semibold hover:bg-sabana-dark transition-colors">
          + Tambah Paket
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-6 border border-gray-200 dark:border-[#333] shadow-sm mb-6">
          <h3 className="font-heading font-semibold mb-4 dark:text-gray-100">{editingId ? "Edit Paket" : "Tambah Paket Baru"}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Nama Paket *</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Harga Paket *</label>
              <input type="number" value={formData.price} onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })} required className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana font-mono" />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Deskripsi</label>
            <input type="text" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana" />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Item dalam Paket</label>
            <textarea value={formData.items} onChange={(e) => setFormData({ ...formData, items: e.target.value })} rows={3} placeholder="Contoh: Ayam Reguler + Nasi + Es Teh" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana" />
          </div>
          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} className="w-4 h-4 text-sabana rounded" />
              <span className="text-sm dark:text-gray-300">Aktif</span>
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-6 py-2.5 bg-success text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50">
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
            <button type="button" onClick={resetForm} className="px-4 py-2.5 border border-gray-200 dark:border-[#444] rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#222]">Batal</button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-gray-200 dark:border-[#333] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin" />
          </div>
        ) : bundles.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            <p className="text-4xl mb-2">📦</p>
            <p>Belum ada paket bundling. Klik &quot;+ Tambah Paket&quot; untuk menambahkan.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#222] border-b border-gray-200 dark:border-[#333]">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 dark:text-gray-400">Nama</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 dark:text-gray-400">Deskripsi</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600 dark:text-gray-400">Harga</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 dark:text-gray-400">Status</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600 dark:text-gray-400">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#333]">
                {bundles.map((bundle) => (
                  <tr key={bundle.id} className="hover:bg-gray-50 dark:hover:bg-[#222] transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm text-gray-900 dark:text-gray-100">{bundle.name}</p>
                      {bundle.items && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{bundle.items}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{bundle.description || "-"}</td>
                    <td className="px-4 py-3 text-right font-bold text-sm text-sabana">{formatRupiah(bundle.price)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${bundle.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {bundle.is_active ? "✅ Aktif" : "❌ Nonaktif"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleEdit(bundle)} className="px-2 py-1 text-xs rounded-lg hover:bg-gray-100 dark:hover:bg-[#333]">✏️</button>
                        <button onClick={() => handleDelete(bundle.id)} className="px-2 py-1 text-xs rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-danger">🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
