"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah, SERVICE_MODE_LABELS } from "@/lib/format";
import ModalShell from "@/components/ui/ModalShell";

interface RecentOrder {
  id: string;
  order_number: number;
  service_mode: string;
  total: number;
  payment_method: string;
  status: string;
  created_at: string;
  items_summary: string;
}

interface RecentOrdersProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function RecentOrders({ isOpen, onClose }: RecentOrdersProps) {
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    fetchRecentOrders();
  }, [isOpen]);

  async function fetchRecentOrders() {
    setLoading(true);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: ordersData } = await supabase
        .from("orders")
        .select("*")
        .gte("created_at", today.toISOString())
        .order("created_at", { ascending: false })
        .limit(20);

      if (!ordersData) { setLoading(false); return; }

      // Fetch items for each order
      const enriched = await Promise.all(
        ordersData.map(async (order) => {
          const { data: items } = await supabase
            .from("order_items")
            .select("quantity, products(name)")
            .eq("order_id", order.id);

          const summary = items
            ?.map((i: any) => `${i.quantity}× ${i.products?.name || "?"}`)
            .join(", ") || "";

          return { ...order, items_summary: summary };
        })
      );

      setOrders(enriched);
    } catch (err) {
      console.error("Error fetching recent orders:", err);
    } finally {
      setLoading(false);
    }
  }

  const handleCancel = async (orderId: string) => {
    if (!confirm("Batalkan order ini?")) return;
    try {
      await supabase.from("orders").update({ status: "cancelled" }).eq("id", orderId);
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: "cancelled" } : o));
    } catch (err) {
      alert("Gagal membatalkan");
    }
  };

  if (!isOpen) return null;

  return (
    <ModalShell open={isOpen} onClose={onClose} className="max-w-md">
      <div className="flex max-h-[calc(100vh-48px)] flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-[#333] flex items-center justify-between">
          <h3 className="font-heading font-bold text-lg text-gray-900 dark:text-gray-100">📋 Order Hari Ini</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-[#333] flex items-center justify-center hover:bg-gray-200 dark:hover:bg-[#444] text-gray-500 dark:text-gray-400">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-sabana border-t-transparent rounded-full animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-8">Belum ada order hari ini</p>
          ) : (
            orders.map((order) => (
              <div key={order.id} className={`p-3 rounded-xl border transition-all ${order.status === "cancelled" ? "border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 opacity-60" : "border-gray-200 dark:border-[#333] hover:border-gray-300 dark:hover:border-[#444]"}`}>
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <p className="text-xs font-mono text-gray-400 dark:text-gray-500">#{order.id.slice(0, 8)}</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {SERVICE_MODE_LABELS[order.service_mode] || order.service_mode}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm text-sabana">{formatRupiah(order.total)}</p>
                    <p className="text-[10px] text-gray-400">{new Date(order.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{order.items_summary}</p>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${order.status === "cancelled" ? "bg-red-100 text-red-600" : order.payment_method === "estimate" ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"}`}>
                    {order.status === "cancelled" ? "Dibatalkan" : order.payment_method === "estimate" ? "Estimasi" : order.payment_method.toUpperCase()}
                  </span>
                  {order.status !== "cancelled" && (
                    <button onClick={() => handleCancel(order.id)} className="text-[10px] text-red-500 hover:text-red-700 font-medium">
                      ❌ Batalkan
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </ModalShell>
  );
}
