"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";

type AuditLog = {
  id: string;
  action: string;
  entity: string;
  entity_id: string;
  entity_name: string;
  user_id: string;
  user_name: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800",
  UPDATE: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
  LOGIN: "bg-purple-100 text-purple-800",
  LOGOUT: "bg-gray-100 text-gray-800",
  PAYMENT: "bg-yellow-100 text-yellow-800",
  SHIFT_OPEN: "bg-sabana-100 text-sabana-800",
  SHIFT_CLOSE: "bg-orange-100 text-orange-800",
};

const ACTION_ICONS: Record<string, string> = {
  CREATE: "➕",
  UPDATE: "✏️",
  DELETE: "🗑️",
  LOGIN: "🔑",
  LOGOUT: "🚪",
  PAYMENT: "💰",
  SHIFT_OPEN: "🟢",
  SHIFT_CLOSE: "🔴",
};

const ENTITY_ICONS: Record<string, string> = {
  product: "📦",
  category: "🏷️",
  order: "🛒",
  shift: "⏰",
  user: "👤",
  customer: "👥",
  promo: "🎁",
  stock: "📊",
  settings: "⚙️",
};

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    entity: "",
    action: "",
    startDate: "",
    endDate: "",
  });
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    today: 0,
    byAction: {} as Record<string, number>,
    byEntity: {} as Record<string, number>,
  });

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false });

      if (filters.entity) {
        query = query.eq("entity", filters.entity);
      }
      if (filters.action) {
        query = query.eq("action", filters.action);
      }
      if (filters.startDate) {
        query = query.gte("created_at", filters.startDate);
      }
      if (filters.endDate) {
        query = query.lte("created_at", filters.endDate + "T23:59:59");
      }

      const { data, error } = await query.limit(100);

      if (error) throw error;
      setLogs(data || []);

      // Calculate stats
      const allLogs = data || [];
      const today = new Date().toISOString().split("T")[0];
      
      const byAction: Record<string, number> = {};
      const byEntity: Record<string, number> = {};

      allLogs.forEach((log) => {
        byAction[log.action] = (byAction[log.action] || 0) + 1;
        byEntity[log.entity] = (byEntity[log.entity] || 0) + 1;
      });

      setStats({
        total: allLogs.length,
        today: allLogs.filter((l) => l.created_at?.startsWith(today)).length,
        byAction,
        byEntity,
      });
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatAction = (action: string) => {
    const map: Record<string, string> = {
      CREATE: "Membuat",
      UPDATE: "Mengubah",
      DELETE: "Menghapus",
      LOGIN: "Login",
      LOGOUT: "Logout",
      PAYMENT: "Pembayaran",
      SHIFT_OPEN: "Buka Shift",
      SHIFT_CLOSE: "Tutup Shift",
    };
    return map[action] || action;
  };

  const formatEntity = (entity: string) => {
    const map: Record<string, string> = {
      product: "Produk",
      category: "Kategori",
      order: "Pesanan",
      shift: "Shift",
      user: "User",
      customer: "Customer",
      promo: "Promo",
      stock: "Stok",
      settings: "Pengaturan",
    };
    return map[entity] || entity;
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-heading font-bold text-gray-900">📋 Audit Log</h1>
        <p className="text-gray-500 text-sm mt-0.5">Riwayat semua perubahan data dan aktivitas</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-gray-500 text-sm">Total Log</p>
          <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-gray-500 text-sm">Hari Ini</p>
          <p className="text-2xl font-bold text-sabana">{stats.today}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-gray-500 text-sm">Transaksi</p>
          <p className="text-2xl font-bold text-green-600">{stats.byAction["PAYMENT"] || 0}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-gray-500 text-sm">Login</p>
          <p className="text-2xl font-bold text-purple-600">{stats.byAction["LOGIN"] || 0}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 mb-4">
        <div className="flex flex-wrap gap-3">
          <select
            value={filters.entity}
            onChange={(e) => setFilters({ ...filters, entity: e.target.value })}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sabana"
          >
            <option value="">Semua Entity</option>
            <option value="product">Produk</option>
            <option value="order">Pesanan</option>
            <option value="shift">Shift</option>
            <option value="user">User</option>
            <option value="customer">Customer</option>
            <option value="promo">Promo</option>
            <option value="stock">Stok</option>
          </select>

          <select
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sabana"
          >
            <option value="">Semua Aksi</option>
            <option value="CREATE">Membuat</option>
            <option value="UPDATE">Mengubah</option>
            <option value="DELETE">Menghapus</option>
            <option value="LOGIN">Login</option>
            <option value="PAYMENT">Pembayaran</option>
            <option value="SHIFT_OPEN">Buka Shift</option>
            <option value="SHIFT_CLOSE">Tutup Shift</option>
          </select>

          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sabana"
          />

          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sabana"
          />

          <button
            onClick={() => setFilters({ entity: "", action: "", startDate: "", endDate: "" })}
            className="px-3 py-2 text-gray-500 hover:text-gray-700 text-sm"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Log List */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-xl p-8 border border-gray-100 text-center">
          <span className="text-4xl mb-3 block">📋</span>
          <p className="text-gray-500">Tidak ada log ditemukan</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-100">
          {logs.map((log) => (
            <div
              key={log.id}
              onClick={() => setSelectedLog(selectedLog?.id === log.id ? null : log)}
              className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl">{ACTION_ICONS[log.action] || "📝"}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[log.action] || "bg-gray-100 text-gray-800"}`}>
                      {formatAction(log.action)}
                    </span>
                    <span className="text-sm text-gray-800 font-medium">
                      {ENTITY_ICONS[log.entity]} {formatEntity(log.entity)}
                    </span>
                    {log.entity_name && (
                      <span className="text-sm text-gray-600 truncate">
                        &quot;{log.entity_name}&quot;
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>👤 {log.user_name || "System"}</span>
                    <span>•</span>
                    <span>{formatDate(log.created_at)}</span>
                    <span>{formatTime(log.created_at)}</span>
                  </div>
                </div>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${selectedLog?.id === log.id ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* Expanded Details */}
              {selectedLog?.id === log.id && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {log.before && (
                      <div className="bg-red-50 rounded-lg p-3">
                        <p className="text-xs font-medium text-red-700 mb-1">Sebelum:</p>
                        <pre className="text-xs text-red-600 overflow-auto max-h-32">
                          {JSON.stringify(log.before, null, 2)}
                        </pre>
                      </div>
                    )}
                    {log.after && (
                      <div className="bg-green-50 rounded-lg p-3">
                        <p className="text-xs font-medium text-green-700 mb-1">Sesudah:</p>
                        <pre className="text-xs text-green-600 overflow-auto max-h-32">
                          {JSON.stringify(log.after, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                  {log.metadata && (
                    <div className="mt-2 bg-gray-50 rounded-lg p-3">
                      <p className="text-xs font-medium text-gray-700 mb-1">Metadata:</p>
                      <pre className="text-xs text-gray-600 overflow-auto max-h-32">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                  <div className="mt-2 text-xs text-gray-400">
                    Entity ID: {log.entity_id || "N/A"} • User ID: {log.user_id || "N/A"}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
