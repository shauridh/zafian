"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";

interface Promo {
  id: string;
  name: string;
  type: "percentage" | "fixed" | "bundle";
  value: number;
  min_purchase: number;
  product_id?: string;
  bundle_id?: string;
  start_date?: string;
  end_date?: string;
  is_active: boolean;
  created_at: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
}

const PROMO_TYPES = [
  { value: "percentage", label: "Persentase (%)", icon: "💯", desc: "Diskon persen dari total" },
  { value: "fixed", label: "Nominal (Rp)", icon: "💵", desc: "Potongan harga tetap" },
  { value: "bundle", label: "Bundle/Combo", icon: "🎁", desc: "Paket hemat gabungan" },
];

export default function PromosPage() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    type: "percentage" as "percentage" | "fixed" | "bundle",
    value: 0,
    min_purchase: 0,
    start_date: "",
    end_date: "",
    is_active: true,
  });

  useEffect(() => {
    async function fetchData() {
      const [promoRes, prodRes] = await Promise.all([
        supabase.from("promos").select("*").order("created_at", { ascending: false }),
        supabase.from("products").select("id, name, price").eq("is_active", true).order("name"),
      ]);
      if (promoRes.data) setPromos(promoRes.data);
      if (prodRes.data) setProducts(prodRes.data);
      setLoading(false);
    }
    fetchData();
  }, []);

  const activePromos = promos.filter((p) => p.is_active);
  const inactivePromos = promos.filter((p) => !p.is_active);

  const resetForm = () => {
    setFormData({ name: "", type: "percentage", value: 0, min_purchase: 0, start_date: "", end_date: "", is_active: true });
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (promo: Promo) => {
    setEditingId(promo.id);
    setFormData({
      name: promo.name,
      type: promo.type,
      value: promo.value,
      min_purchase: promo.min_purchase || 0,
      start_date: promo.start_date ? promo.start_date.split("T")[0] : "",
      end_date: promo.end_date ? promo.end_date.split("T")[0] : "",
      is_active: promo.is_active,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        type: formData.type,
        value: formData.value,
        min_purchase: formData.min_purchase || 0,
        start_date: formData.start_date || undefined,
        end_date: formData.end_date || undefined,
        is_active: formData.is_active,
      };

      if (editingId) {
        await supabase.from("promos").update(payload).eq("id", editingId);
        setPromos((prev) => prev.map((p) => p.id === editingId ? { ...p, ...payload } : p));
      } else {
        const { data, error } = await supabase.from("promos").insert(payload).select().single();
        if (error) throw error;
        if (data) setPromos((prev) => [data, ...prev]);
      }
      resetForm();
    } catch (err: any) { alert("Error: " + err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus promo ini?")) return;
    await supabase.from("promos").delete().eq("id", id);
    setPromos((prev) => prev.filter((p) => p.id !== id));
  };

  const handleToggle = async (id: string, current: boolean) => {
    await supabase.from("promos").update({ is_active: !current }).eq("id", id);
    setPromos((prev) => prev.map((p) => p.id === id ? { ...p, is_active: !current } : p));
  };

  const getPromoType = (type: string) => PROMO_TYPES.find((t) => t.value === type) || PROMO_TYPES[0];

  const formatValue = (type: string, value: number) => {
    if (type === "percentage") return `${value}%`;
    if (type === "fixed") return formatRupiah(value);
    return formatRupiah(value);
  };

  const isExpired = (endDate?: string) => {
    if (!endDate) return false;
    return new Date(endDate) < new Date();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-heading font-bold text-gray-900">🏷️ Promo & Diskon</h1>
          <p className="text-gray-500 text-sm mt-0.5">Kelola promo, diskon, dan bundle</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); resetForm(); }} className="px-4 py-2 bg-sabana text-white rounded-xl font-semibold hover:bg-sabana-dark transition-colors text-sm">
          + Buat Promo
        </button>
      </div>

      {/* Promo Type Legend */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {PROMO_TYPES.map((t) => (
          <div key={t.value} className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm text-center">
            <span className="text-2xl block mb-1">{t.icon}</span>
            <p className="text-xs font-semibold text-gray-900">{t.label}</p>
            <p className="text-[10px] text-gray-500">{t.desc}</p>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
          <h3 className="font-heading font-semibold mb-3">{editingId ? "Edit Promo" : "Buat Promo Baru"}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">Nama Promo *</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required placeholder="Contoh: Happy Hour 10%" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Tipe *</label>
              <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as any })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm">
                {PROMO_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.icon} {t.label}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                {formData.type === "percentage" ? "Persentase (%)" : "Nominal (Rp)"}
              </label>
              <input type="number" value={formData.value} onChange={(e) => setFormData({ ...formData, value: Number(e.target.value) })} required className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm font-mono" min={0} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Min. Belanja (Rp)</label>
              <input type="number" value={formData.min_purchase} onChange={(e) => setFormData({ ...formData, min_purchase: Number(e.target.value) })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm font-mono" min={0} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Tanggal Mulai</label>
              <input type="date" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Tanggal Selesai</label>
              <input type="date" value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer mb-4">
            <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} className="w-4 h-4 text-sabana rounded" />
            <span className="text-sm text-gray-600">Aktif</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-6 py-2.5 bg-success text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50 text-sm">
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
            <button type="button" onClick={resetForm} className="px-4 py-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 text-sm">Batal</button>
          </div>
        </form>
      )}

      {/* Active Promos */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-600 mb-2">🟢 Aktif ({activePromos.length})</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {activePromos.map((promo) => {
            const typeInfo = getPromoType(promo.type);
            return (
              <div key={promo.id} className={`bg-white rounded-xl p-4 border shadow-sm ${isExpired(promo.end_date) ? "opacity-60 border-gray-200" : "border-green-200"}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{typeInfo.icon}</span>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{promo.name}</p>
                      <span className="text-xs text-gray-500">{typeInfo.label}</span>
                    </div>
                  </div>
                  <button onClick={() => handleToggle(promo.id, promo.is_active)} className={`relative w-10 h-6 rounded-full transition-colors ${promo.is_active ? "bg-success" : "bg-gray-300"}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${promo.is_active ? "left-5" : "left-1"}`} />
                  </button>
                </div>
                <div className="bg-sabana-50 rounded-lg p-3 text-center mb-2">
                  <p className="text-2xl font-bold text-sabana">{formatValue(promo.type, promo.value)}</p>
                  {promo.min_purchase > 0 && <p className="text-xs text-gray-500">Min. belanja {formatRupiah(promo.min_purchase)}</p>}
                </div>
                {promo.start_date && promo.end_date && (
                  <p className="text-[10px] text-gray-400 text-center mb-2">
                    {new Date(promo.start_date).toLocaleDateString("id-ID")} — {new Date(promo.end_date).toLocaleDateString("id-ID")}
                  </p>
                )}
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(promo)} className="flex-1 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50">✏️ Edit</button>
                  <button onClick={() => handleDelete(promo.id)} className="py-1.5 px-3 text-xs font-medium rounded-lg border border-gray-200 hover:bg-red-50 hover:text-danger">🗑️</button>
                </div>
              </div>
            );
          })}
          {activePromos.length === 0 && <p className="text-sm text-gray-400 col-span-3 text-center py-4">Belum ada promo aktif</p>}
        </div>
      </div>

      {/* Inactive Promos */}
      {inactivePromos.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-600 mb-2">⚪ Nonaktif ({inactivePromos.length})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {inactivePromos.map((promo) => {
              const typeInfo = getPromoType(promo.type);
              return (
                <div key={promo.id} className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm opacity-60">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl grayscale">{typeInfo.icon}</span>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{promo.name}</p>
                      <span className="text-xs text-gray-500">{typeInfo.label}</span>
                    </div>
                  </div>
                  <p className="text-lg font-bold text-gray-400 mb-2">{formatValue(promo.type, promo.value)}</p>
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(promo)} className="flex-1 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50">✏️ Edit</button>
                    <button onClick={() => handleDelete(promo.id)} className="py-1.5 px-3 text-xs font-medium rounded-lg border border-gray-200 hover:bg-red-50 hover:text-danger">🗑️</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
