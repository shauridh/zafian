"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";

interface User {
  id: string;
  name: string;
  role: string;
  outlet_id: string;
  pin?: string;
  phone?: string;
  is_active: boolean;
  created_at: string;
}

const ROLES = [
  { value: "cashier", label: "Kasir", icon: "🧑‍💼", color: "bg-blue-100 text-blue-700" },
  { value: "admin", label: "Admin", icon: "👨‍💻", color: "bg-purple-100 text-purple-700" },
  { value: "manager", label: "Manager", icon: "👨‍💼", color: "bg-green-100 text-green-700" },
  { value: "customer", label: "Customer", icon: "🧑", color: "bg-gray-100 text-gray-700" },
];

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    role: "cashier",
    pin: "",
    phone: "",
    is_active: true,
  });

  // Fetch users
  useEffect(() => {
    async function fetchUsers() {
      const { data } = await supabase
        .from("users")
        .select("*")
        .order("name");
      if (data) setUsers(data);
      setLoading(false);
    }
    fetchUsers();
  }, []);

  const filteredUsers = users.filter((u) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.role.toLowerCase().includes(q) || u.phone?.toLowerCase().includes(q);
  });

  const resetForm = () => {
    setFormData({ name: "", role: "cashier", pin: "", phone: "", is_active: true });
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (user: User) => {
    setEditingId(user.id);
    setFormData({
      name: user.name,
      role: user.role,
      pin: user.pin || "",
      phone: user.phone || "",
      is_active: user.is_active,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        role: formData.role,
        pin: formData.pin || undefined,
        phone: formData.phone || undefined,
        is_active: formData.is_active,
        outlet_id: "00000000-0000-0000-0000-000000000001",
      };

      if (editingId) {
        await supabase.from("users").update(payload).eq("id", editingId);
        setUsers((prev) => prev.map((u) => u.id === editingId ? { ...u, ...payload } : u));
      } else {
        const { data, error } = await supabase.from("users").insert(payload).select().single();
        if (error) throw error;
        if (data) setUsers((prev) => [...prev, data]);
      }
      resetForm();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus user ini?")) return;
    try {
      await supabase.from("users").delete().eq("id", id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      await supabase.from("users").update({ is_active: !currentActive }).eq("id", id);
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, is_active: !currentActive } : u));
    } catch (err: any) {
      console.error("Error toggling user:", err);
    }
  };

  const getRoleInfo = (role: string) => ROLES.find((r) => r.value === role) || ROLES[0];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Memuat data user...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-heading font-bold text-gray-900">👥 Manajemen User</h1>
          <p className="text-gray-500 text-sm mt-0.5">Kelola kasir, admin, dan manager</p>
        </div>
        <button
          onClick={() => { if (showForm) { resetForm(); } else { setEditingId(null); setFormData({ name: "", role: "cashier", pin: "", phone: "", is_active: true }); setShowForm(true); } }}
          className="px-4 py-2 bg-sabana text-white rounded-xl font-semibold hover:bg-sabana-dark transition-colors text-sm"
        >
          + Tambah User
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
          <h3 className="font-heading font-semibold mb-3">{editingId ? "Edit User" : "Tambah User Baru"}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Nama *</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Role *</label>
              <select value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm">
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.icon} {r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">PIN (untuk login kasir)</label>
              <input type="password" value={formData.pin} onChange={(e) => setFormData({ ...formData, pin: e.target.value })} placeholder="4-6 digit" maxLength={6} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">No. HP</label>
              <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="08xx-xxxx-xxxx" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
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
            <button type="button" onClick={resetForm} className="px-4 py-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 text-sm">
              Batal
            </button>
          </div>
        </form>
      )}

      {/* Search */}
      <div className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm mb-4">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Cari nama, role, atau no. HP..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
        </div>
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredUsers.map((user) => {
          const roleInfo = getRoleInfo(user.role);
          return (
            <div key={user.id} className={`bg-white rounded-xl p-4 border shadow-sm transition-all ${user.is_active ? "border-gray-200" : "border-gray-200 opacity-60"}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white ${user.is_active ? "bg-sabana" : "bg-gray-400"}`}>
                    {user.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{user.name}</p>
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${roleInfo.color}`}>
                      {roleInfo.icon} {roleInfo.label}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleToggleActive(user.id, user.is_active)}
                  className={`relative w-10 h-6 rounded-full transition-colors ${user.is_active ? "bg-success" : "bg-gray-300"}`}
                  title={user.is_active ? "Nonaktifkan" : "Aktifkan"}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${user.is_active ? "left-5" : "left-1"}`} />
                </button>
              </div>
              <div className="space-y-1 text-xs text-gray-500 mb-3">
                {user.phone && <p>📱 {user.phone}</p>}
                {user.pin && <p>🔐 PIN: {"•".repeat(user.pin.length)}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleEdit(user)} className="flex-1 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  ✏️ Edit
                </button>
                <button onClick={() => handleDelete(user.id)} className="py-1.5 px-3 text-xs font-medium rounded-lg border border-gray-200 hover:bg-red-50 hover:text-danger transition-colors">
                  🗑️
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredUsers.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <span className="text-3xl block mb-2">👥</span>
          <p className="text-sm">Tidak ada user ditemukan</p>
        </div>
      )}
    </div>
  );
}
