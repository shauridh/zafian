"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";

interface LoyaltyCustomer {
  id: string;
  phone: string;
  name: string;
  points: number;
  stamps: number;
  total_spent: number;
  created_at: string;
}

interface LoyaltyTransaction {
  id: string;
  customer_id: string;
  order_id: string;
  points_earned: number;
  points_redeemed: number;
  stamps_earned: number;
  created_at: string;
}

const POINTS_PER_RP = 10; // 1 point per Rp 10.000
const STAMP_GOAL = 10; // 10 stamps = reward
const REWARD_VALUE = 15000; // Rp 15.000 reward

export default function LoyaltyPage() {
  const [customers, setCustomers] = useState<LoyaltyCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<LoyaltyCustomer | null>(null);
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([]);

  const [formData, setFormData] = useState({ name: "", phone: "" });

  // Fetch customers
  useEffect(() => {
    async function fetchData() {
      const { data } = await supabase.from("loyalty_customers").select("*").order("points", { ascending: false });
      if (data) setCustomers(data);
      setLoading(false);
    }
    fetchData();
  }, []);

  // Fetch transactions for selected customer
  useEffect(() => {
    if (!selectedCustomer) { setTransactions([]); return; }
    async function fetchTx() {
      const { data } = await supabase.from("loyalty_transactions").select("*").eq("customer_id", selectedCustomer!.id).order("created_at", { ascending: false }).limit(20);
      if (data) setTransactions(data);
    }
    fetchTx();
  }, [selectedCustomer]);

  const filtered = customers.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return c.name?.toLowerCase().includes(q) || c.phone.includes(q);
  });

  const resetForm = () => { setFormData({ name: "", phone: "" }); setEditingId(null); setShowForm(false); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await supabase.from("loyalty_customers").update({ name: formData.name, phone: formData.phone }).eq("id", editingId);
        setCustomers((prev) => prev.map((c) => c.id === editingId ? { ...c, name: formData.name, phone: formData.phone } : c));
      } else {
        const { data, error } = await supabase.from("loyalty_customers").insert({ name: formData.name, phone: formData.phone, points: 0, stamps: 0, total_spent: 0 }).select().single();
        if (error) throw error;
        if (data) setCustomers((prev) => [...prev, data]);
      }
      resetForm();
    } catch (err: any) { alert("Error: " + err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus customer ini?")) return;
    await supabase.from("loyalty_customers").delete().eq("id", id);
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    if (selectedCustomer?.id === id) setSelectedCustomer(null);
  };

  const getStampProgress = (stamps: number) => ((stamps % STAMP_GOAL) / STAMP_GOAL) * 100;

  const getTier = (points: number) => {
    if (points >= 5000) return { label: "Platinum", color: "bg-purple-100 text-purple-700", icon: "💎" };
    if (points >= 2000) return { label: "Gold", color: "bg-yellow-100 text-yellow-700", icon: "🥇" };
    if (points >= 500) return { label: "Silver", color: "bg-gray-100 text-gray-600", icon: "🥈" };
    return { label: "Bronze", color: "bg-orange-100 text-orange-700", icon: "🥉" };
  };

  // Stats
  const stats = {
    totalCustomers: customers.length,
    totalPoints: customers.reduce((s, c) => s + c.points, 0),
    totalSpent: customers.reduce((s, c) => s + c.total_spent, 0),
    avgSpent: customers.length > 0 ? Math.round(customers.reduce((s, c) => s + c.total_spent, 0) / customers.length) : 0,
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
          <h1 className="text-xl md:text-2xl font-heading font-bold text-gray-900">⭐ Loyalty Program</h1>
          <p className="text-gray-500 text-sm mt-0.5">Poin & stamp untuk repeat customer</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); resetForm(); }} className="px-4 py-2 bg-sabana text-white rounded-xl font-semibold hover:bg-sabana-dark transition-colors text-sm">
          + Tambah Customer
        </button>
      </div>

      {/* Reward Info */}
      <div className="bg-gradient-to-r from-sabana to-orange-500 rounded-2xl p-4 text-white mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-heading font-bold text-lg">🍗 Sabana Rewards</h3>
            <p className="text-white/80 text-sm">1 poin per Rp 10.000 belanja · {STAMP_GOAL} stamp = Reward {formatRupiah(REWARD_VALUE)}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{stats.totalPoints.toLocaleString()}</p>
            <p className="text-white/80 text-xs">Total Poin</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Total Customer", value: stats.totalCustomers },
          { label: "Total Poin", value: stats.totalPoints.toLocaleString() },
          { label: "Total Belanja", value: formatRupiah(stats.totalSpent) },
          { label: "Rata-rata", value: formatRupiah(stats.avgSpent) },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className="text-lg font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
          <h3 className="font-heading font-semibold mb-3">{editingId ? "Edit Customer" : "Tambah Customer Baru"}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Nama *</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">No. HP *</label>
              <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} required placeholder="08xx-xxxx-xxxx" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-6 py-2.5 bg-success text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50 text-sm">
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
            <button type="button" onClick={resetForm} className="px-4 py-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 text-sm">Batal</button>
          </div>
        </form>
      )}

      {/* Search */}
      <div className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm mb-4">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" placeholder="Cari nama atau no. HP..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
        </div>
      </div>

      {/* Customer List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((customer) => {
          const tier = getTier(customer.points);
          const progress = getStampProgress(customer.stamps);
          const completedStamps = Math.floor(customer.stamps / STAMP_GOAL);
          return (
            <div key={customer.id} className={`bg-white rounded-xl p-4 border shadow-sm cursor-pointer transition-all hover:shadow-md ${selectedCustomer?.id === customer.id ? "border-sabana ring-2 ring-sabana/20" : "border-gray-200"}`}
              onClick={() => setSelectedCustomer(selectedCustomer?.id === customer.id ? null : customer)}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-sabana flex items-center justify-center text-white font-bold">{customer.name?.charAt(0) || "?"}</div>
                  <div>
                    <p className="font-semibold text-gray-900">{customer.name || "Tanpa Nama"}</p>
                    <p className="text-xs text-gray-500">📱 {customer.phone}</p>
                  </div>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tier.color}`}>{tier.icon} {tier.label}</span>
              </div>

              {/* Points */}
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-500">Poin</span>
                <span className="font-bold text-sabana">{customer.points.toLocaleString()}</span>
              </div>

              {/* Stamp Progress */}
              <div className="mb-2">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-500">Stamp ({customer.stamps % STAMP_GOAL}/{STAMP_GOAL})</span>
                  <span className="text-gray-400">×{completedStamps} reward</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-sabana h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>

              {/* Total Spent */}
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Total belanja</span>
                <span className="font-medium">{formatRupiah(customer.total_spent)}</span>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-3">
                <button onClick={(e) => { e.stopPropagation(); setEditingId(customer.id); setFormData({ name: customer.name || "", phone: customer.phone }); setShowForm(true); }} className="flex-1 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50">✏️ Edit</button>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(customer.id); }} className="py-1.5 px-3 text-xs font-medium rounded-lg border border-gray-200 hover:bg-red-50 hover:text-danger">🗑️</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Transaction History */}
      {selectedCustomer && transactions.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm mt-4">
          <h3 className="font-heading font-semibold text-sm mb-3">📜 Riwayat — {selectedCustomer.name}</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between text-xs py-2 border-b border-gray-100 last:border-0">
                <span className="text-gray-500">{new Date(tx.created_at).toLocaleDateString("id-ID")}</span>
                <div className="flex gap-2">
                  {tx.points_earned > 0 && <span className="text-success font-medium">+{tx.points_earned} poin</span>}
                  {tx.points_redeemed > 0 && <span className="text-danger font-medium">-{tx.points_redeemed} poin</span>}
                  {tx.stamps_earned > 0 && <span className="text-sabana font-medium">+{tx.stamps_earned} stamp 🍗</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
