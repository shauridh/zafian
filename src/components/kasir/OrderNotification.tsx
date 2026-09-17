"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";

type NewOrder = {
  id: string;
  created_at: string;
  total: number;
  customer_name?: string;
  phone?: string;
  items?: { name: string; qty: number; price: number }[];
  order_number?: string;
  order_source?: string;
};

interface OrderNotificationProps {
  onAccept?: (orderId: string) => void;
  onReject?: (orderId: string) => void;
  soundEnabled?: boolean;
}

// Simple beep sound generator using Web Audio API
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // First tone - high
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.value = 880;
    gain1.gain.value = 0.3;
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);

    // Second tone - higher (ding dong)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.value = 1100;
    gain2.gain.value = 0.3;
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.35);

    // Third tone - confirm
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = "sine";
    osc3.frequency.value = 1320;
    gain3.gain.value = 0.2;
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(ctx.currentTime + 0.35);
    osc3.stop(ctx.currentTime + 0.55);
  } catch {
    // Audio not available
  }
}

export default function OrderNotification({ onAccept, onReject, soundEnabled = true }: OrderNotificationProps) {
  const [notifications, setNotifications] = useState<NewOrder[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const lastCheckRef = useRef<string>(new Date().toISOString());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const checkNewOrders = useCallback(async () => {
    try {
      const { data: orders, error } = await supabase
        .from("orders")
        .select("*")
        .eq("status", "pending")
        .eq("order_source", "customer_portal")
        .gte("created_at", lastCheckRef.current)
        .order("created_at", { ascending: false });

      if (error || !orders || orders.length === 0) return;

      // Filter out already notified orders
      const newOrders = orders.filter(
        (o) => !notifications.find((n) => n.id === o.id)
      );

      if (newOrders.length > 0) {
        // Play sound
        if (soundEnabled) {
          playNotificationSound();
        }

        setNotifications((prev) => [...newOrders, ...prev].slice(0, 10));
      }

      lastCheckRef.current = new Date().toISOString();
    } catch (err) {
      console.error("Error checking orders:", err);
    }
  }, [notifications, soundEnabled]);

  useEffect(() => {
    // Poll for new orders every 5 seconds
    const interval = setInterval(checkNewOrders, 5000);
    return () => clearInterval(interval);
  }, [checkNewOrders]);

  // Real-time subscription for instant notifications
  useEffect(() => {
    const channel = supabase
      .channel("new-orders")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: "status=eq.pending",
        },
        (payload) => {
          const order = payload.new as NewOrder;
          if (order.order_source === "customer_portal") {
            if (soundEnabled) playNotificationSound();
            setNotifications((prev) => [order, ...prev].slice(0, 10));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [soundEnabled]);

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const acceptOrder = async (order: NewOrder) => {
    try {
      await supabase
        .from("orders")
        .update({ status: "confirmed" })
        .eq("id", order.id);
      onAccept?.(order.id);
      dismissNotification(order.id);
    } catch (err) {
      console.error("Error accepting order:", err);
    }
  };

  const rejectOrder = async (order: NewOrder) => {
    try {
      await supabase
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", order.id);
      onReject?.(order.id);
      dismissNotification(order.id);
    } catch (err) {
      console.error("Error rejecting order:", err);
    }
  };

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-[100] space-y-2 max-w-sm">
      {notifications.map((order, idx) => (
        <div
          key={order.id}
          className="bg-white rounded-2xl shadow-2xl border-2 border-sabana overflow-hidden animate-slide-in-right"
          style={{
            animation: "slideInRight 0.4s ease-out",
            transform: `translateY(${idx * 4}px)`,
          }}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-sabana to-sabana-dark px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                <span className="text-white text-lg">🔔</span>
              </div>
              <div>
                <p className="text-white font-bold text-sm">Order Baru!</p>
                <p className="text-white/60 text-[10px]">{order.id.slice(0, 8)}...</p>
              </div>
            </div>
            <button
              onClick={() => dismissNotification(order.id)}
              className="text-white/60 hover:text-white text-lg"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm text-gray-500">Dari</p>
                <p className="font-bold text-gray-800">{order.customer_name || "Customer"}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Total</p>
                <p className="font-extrabold text-sabana text-lg">{formatRupiah(order.total)}</p>
              </div>
            </div>

            <p className="text-[10px] text-gray-400 mb-3">
              {new Date(order.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => acceptOrder(order)}
                className="flex-1 py-2.5 bg-success text-white rounded-xl font-bold text-sm hover:bg-green-700 transition-colors"
              >
                ✅ Terima
              </button>
              <button
                onClick={() => rejectOrder(order)}
                className="flex-1 py-2.5 bg-red-100 text-danger rounded-xl font-bold text-sm hover:bg-red-200 transition-colors"
              >
                ❌ Tolak
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* CSS Animation */}
      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(120%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.4s ease-out;
        }
      `}</style>
    </div>
  );
}
