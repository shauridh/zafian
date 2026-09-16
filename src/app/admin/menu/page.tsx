"use client";

import React, { useState } from "react";
import { useSupabaseCRUD } from "@/hooks/useSupabaseCRUD";

interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export default function MenuPage() {
  const { data: categories, loading, create, update, remove, refresh } =
    useSupabaseCRUD<Category>("categories", {
      orderBy: { column: "sort_order", ascending: true },
    });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", icon: "🍗", color: "#EA580C", sort_order: 0 });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await update(editingId, { ...formData, is_active: true } as any);
      } else {
        const maxSort = categories.length > 0 ? Math.max(...categories.map((c) => c.sort_order)) + 1 : 1;
        await create({ ...formData, sort_order: maxSort, is_active: true, created_at: new Date().toISOString() } as any);
      }
      setShowForm(false);
      setEditingId(null);
      setFormData({ name: "", icon: "🍗", color: "#EA580C", sort_order: 0 });
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (cat: Category) => {
    setEditingId(cat.id);
    setFormData({ name: cat.name, icon: cat.icon, color: cat.color, sort_order: cat.sort_order });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus kategori ini?")) return;
    try {
      await remove(id);
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  const handleToggleActive = async (cat: Category) => {
    try {
      await update(cat.id, { is_active: !cat.is_active } as any);
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-heading font-bold text-gray-900">📋 Menu & Kategori</h1>
          <p className="text-gray-500 mt-1">Kelola kategori menu dari database</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setEditingId(null); setFormData({ name: "", icon: "🍗", color: "#EA580C", sort_order: 0 }); }}
          className="px-4 py-2 bg-sabana text-white rounded-xl font-semibold hover:bg-sabana-dark transition-colors"
        >
          + Tambah Kategori
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm mb-6">
          <h3 className="font-heading font-semibold mb-4">{editingId ? "Edit Kategori" : "Tambah Kategori Baru"}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Nama</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Nama kategori"
                required
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Icon (emoji)</label>
              <input
                type="text"
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Warna</label>
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-full h-[42px] rounded-xl border border-gray-200 cursor-pointer"
              />
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 bg-success text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50">
                {saving ? "Menyimpan..." : "Simpan"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">
                Batal
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-600">Urutan</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-600">Icon</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-600">Nama</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-600">Warna</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-600">Status</th>
                <th className="px-6 py-3 text-right text-sm font-semibold text-gray-600">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 text-sm text-gray-500">{cat.sort_order}</td>
                  <td className="px-6 py-4 text-2xl">{cat.icon}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">{cat.name}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full border border-gray-200" style={{ backgroundColor: cat.color }} />
                      <span className="text-sm text-gray-500">{cat.color}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleToggleActive(cat)}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full transition-colors ${
                        cat.is_active ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cat.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                      {cat.is_active ? "Aktif" : "Nonaktif"}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleEdit(cat)} className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-gray-100">
                        ✏️ Edit
                      </button>
                      <button onClick={() => handleDelete(cat.id)} className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-red-50 text-danger">
                        🗑️ Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    Belum ada kategori. Klik "Tambah Kategori" untuk menambahkan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
