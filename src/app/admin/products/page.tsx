"use client";

import React, { useState, useRef } from "react";
import Link from "next/link";
import { useSupabaseCRUD } from "@/hooks/useSupabaseCRUD";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";

interface Product {
  id: string;
  category_id: string;
  name: string;
  description?: string;
  price: number;
  hpp?: number;
  cost_price?: number;
  sku?: string;
  image_url?: string;
  unit: string;
  is_active: boolean;
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

interface Category {
  id: string;
  name: string;
  icon: string;
}

export default function ProductsPage() {
  const { data: products, loading, create, update, remove, refresh } =
    useSupabaseCRUD<Product>("products", { orderBy: { column: "name", ascending: true } });
  const { data: categories } = useSupabaseCRUD<Category>("categories");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: "",
    category_id: "",
    price: 0,
    hpp: 0,
    cost_price: 0,
    sku: "",
    unit: "pcs",
    description: "",
    image_url: "",
    is_active: true,
    is_available: true,
  });
  const [filters, setFilters] = useState({ name: "", category: "", sku: "", status: "" });

  const resetForm = () => {
    setFormData({
      name: "", category_id: "", price: 0, hpp: 0, cost_price: 0,
      sku: "", unit: "pcs", description: "", image_url: "", is_active: true, is_available: true,
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileName = `products/${Date.now()}-${file.name}`;
      const { data, error } = await supabase.storage.from("images").upload(fileName, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("images").getPublicUrl(fileName);
      setFormData((prev) => ({ ...prev, image_url: urlData.publicUrl }));
    } catch (err: any) {
      // If bucket not found, try to create it or use fallback
      if (err.message?.includes("Bucket not found") || err.message?.includes("not found")) {
        console.warn("[Upload] Storage bucket 'images' not found. Run migration-storage-bucket.sql in Supabase.");
        // Fallback: use a data URL for preview (won't persist)
        const reader = new FileReader();
        reader.onload = () => {
          setFormData((prev) => ({ ...prev, image_url: reader.result as string }));
        };
        reader.readAsDataURL(file);
        alert("⚠️ Storage bucket belum dibuat. Gambar hanya preview lokal.\n\nJalankan migration-storage-bucket.sql di Supabase SQL Editor untuk upload permanen.");
      } else {
        alert("Upload error: " + err.message);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...formData,
        price: Number(formData.price),
        hpp: Number(formData.hpp) || null,
        cost_price: Number(formData.cost_price) || null,
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

  const handleEdit = (product: Product) => {
    setEditingId(product.id);
    setFormData({
      name: product.name,
      category_id: product.category_id,
      price: product.price,
      hpp: product.hpp || 0,
      cost_price: product.cost_price || 0,
      sku: product.sku || "",
      unit: product.unit,
      description: product.description || "",
      image_url: product.image_url || "",
      is_active: product.is_active,
      is_available: product.is_available,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus produk ini?")) return;
    try { await remove(id); } catch (err: any) { alert("Error: " + err.message); }
  };

  const getCategoryName = (id: string) => categories.find((c) => c.id === id)?.name || "-";
  const filteredProducts = products.filter((product) => {
    const category = getCategoryName(product.category_id).toLowerCase();
    const status = product.is_active ? "aktif" : "nonaktif";
    return product.name.toLowerCase().includes(filters.name.toLowerCase())
      && category.includes(filters.category.toLowerCase())
      && (product.sku || "").toLowerCase().includes(filters.sku.toLowerCase())
      && (!filters.status || status === filters.status);
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-heading font-bold text-gray-900">🍗 Produk</h1>
          <p className="text-gray-500 mt-1">Kelola produk, harga, dan gambar dari database</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/bundles" className="px-4 py-2 border border-sabana text-sabana rounded-xl font-semibold hover:bg-sabana-50 transition-colors">🎁 Paket/Bundling</Link>
          <button onClick={() => { if (showForm) { resetForm(); } else { setEditingId(null); setShowForm(true); } }} className="px-4 py-2 bg-sabana text-white rounded-xl font-semibold hover:bg-sabana-dark transition-colors">+ Tambah Produk</button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm mb-6">
          <h3 className="font-heading font-semibold mb-4">{editingId ? "Edit Produk" : "Tambah Produk Baru"}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">Nama Produk *</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Kategori *</label>
              <select value={formData.category_id} onChange={(e) => setFormData({ ...formData, category_id: e.target.value })} required className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana">
                <option value="">Pilih Kategori</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Harga Jual *</label>
              <input type="number" value={formData.price} onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })} required className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">HPP</label>
              <input type="number" value={formData.hpp} onChange={(e) => setFormData({ ...formData, hpp: Number(e.target.value) })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">SKU</label>
              <input type="text" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Satuan</label>
              <select value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana">
                <option value="pcs">Pcs</option>
                <option value="porsi">Porsi</option>
                <option value="cup">Cup</option>
                <option value="tusuk">Tusuk</option>
                <option value="botol">Botol</option>
                <option value="paket">Paket</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Deskripsi</label>
              <input type="text" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Gambar</label>
              <div className="flex gap-2">
                <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm hover:bg-gray-50 disabled:opacity-50">
                  {uploading ? "Uploading..." : "📷 Upload Gambar"}
                </button>
                {formData.image_url && <img src={formData.image_url} alt="Preview" className="w-10 h-10 rounded-lg object-cover" />}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} className="w-4 h-4 text-sabana rounded" />
              <span className="text-sm">Aktif</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={formData.is_available} onChange={(e) => setFormData({ ...formData, is_available: e.target.checked })} className="w-4 h-4 text-sabana rounded" />
              <span className="text-sm">Tersedia</span>
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-6 py-2.5 bg-success text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50">
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
            <button type="button" onClick={resetForm} className="px-4 py-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">Batal</button>
          </div>
        </form>
      )}

      {/* Products Table */}
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
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Gambar</th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">Nama<input aria-label="Filter nama produk" value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} placeholder="Cari nama" className="mt-1 w-full min-w-28 rounded-lg border border-gray-200 px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-sabana" /></th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">Kategori<input aria-label="Filter kategori produk" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} placeholder="Cari kategori" className="mt-1 w-full min-w-28 rounded-lg border border-gray-200 px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-sabana" /></th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Harga</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">HPP</th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">SKU<input aria-label="Filter SKU produk" value={filters.sku} onChange={(e) => setFilters({ ...filters, sku: e.target.value })} placeholder="Cari SKU" className="mt-1 w-full min-w-24 rounded-lg border border-gray-200 px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-sabana" /></th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">Status<select aria-label="Filter status produk" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-sabana"><option value="">Semua</option><option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option></select></th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name} className="w-10 h-10 rounded-lg object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-sabana-50 flex items-center justify-center text-lg">🍗</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm text-gray-900">{product.name}</p>
                      <p className="text-xs text-gray-400">{product.unit}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{getCategoryName(product.category_id)}</td>
                    <td className="px-4 py-3 text-right font-bold text-sm text-sabana">{formatRupiah(product.price)}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500">{product.hpp ? formatRupiah(product.hpp) : "-"}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-500">{product.sku || "-"}</td>
                    <td className="px-4 py-3">
                      <button onClick={async () => { await supabase.from("products").update({ is_active: !product.is_active }).eq("id", product.id); refresh(); }} className={`relative w-10 h-6 rounded-full transition-colors ${product.is_active ? "bg-success" : "bg-gray-300"}`}>
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${product.is_active ? "left-5" : "left-1"}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleEdit(product)} className="w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 flex items-center justify-center text-blue-600 transition-colors" title="Edit">✏️</button>
                        <button onClick={() => handleDelete(product.id)} className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center text-danger transition-colors" title="Hapus">🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredProducts.length === 0 && <tr><td colSpan={8} className="px-6 py-10 text-center text-sm text-gray-400">Tidak ada produk yang sesuai filter.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
