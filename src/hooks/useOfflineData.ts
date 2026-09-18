"use client";

import { useState, useEffect, useCallback } from "react";
import { db, seedFromSupabase, saveOrderLocal, removeLocalOrder } from "@/lib/db";
import { supabase } from "@/lib/supabase/client";
import type { DBCategory, DBProduct } from "@/lib/db";

/**
 * Hook to fetch categories from Dexie (offline-first)
 * Falls back to Supabase if local DB is empty
 */
export function useOfflineCategories() {
  const [categories, setCategories] = useState<DBCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 1. Try local Dexie first
        const localCats = await db.categories.toArray();
        if (!cancelled && localCats.length > 0) {
          setCategories(localCats.sort((a, b) => a.sort_order - b.sort_order));
          setLoading(false);
          return;
        }

        // 2. If empty, fetch from Supabase and seed local
        const { data } = await supabase
          .from("categories")
          .select("*")
          .eq("is_active", true)
          .order("sort_order");

        if (!cancelled && data) {
          const cats: DBCategory[] = data.map((c: any) => ({
            id: c.id,
            name: c.name,
            icon: c.icon,
            color: c.color,
            sort_order: c.sort_order,
            is_active: c.is_active,
          }));

          // Seed Dexie
          await db.categories.clear();
          await db.categories.bulkPut(cats);
          setCategories(cats);
        }
      } catch (err) {
        console.error("[useOfflineCategories] Error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { categories, loading };
}

/**
 * Hook to fetch products from Dexie (offline-first)
 */
export function useOfflineProducts(categoryId?: string | null) {
  const [products, setProducts] = useState<DBProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 1. Try local Dexie first
        let localProducts = await db.products.where("is_active").equals(1).toArray();
        
        // If Dexie has data with indexed filtering
        if (localProducts.length === 0) {
          // Dexie boolean indexing issue — try alternate approach
          const allLocal = await db.products.toArray();
          localProducts = allLocal.filter(p => p.is_active);
        }

        if (!cancelled && localProducts.length > 0) {
          let filtered = localProducts;
          if (categoryId) {
            filtered = filtered.filter(p => p.category_id === categoryId);
          }
          setProducts(filtered.sort((a, b) => a.name.localeCompare(b.name)));
          setLoading(false);
          return;
        }

        // 2. If empty, fetch from Supabase
        let query = supabase
          .from("products")
          .select("*")
          .eq("is_active", true)
          .order("name");

        if (categoryId) {
          query = query.eq("category_id", categoryId);
        }

        const { data } = await query;

        if (!cancelled && data) {
          const prods: DBProduct[] = data.map((p: any) => ({
            id: p.id,
            category_id: p.category_id,
            name: p.name,
            description: p.description,
            price: p.price,
            hpp: p.hpp,
            cost_price: p.cost_price,
            sku: p.sku,
            image_url: p.image_url,
            unit: p.unit,
            is_active: p.is_active,
            is_available: p.is_available,
          }));

          // Seed Dexie with all products
          await db.products.clear();
          await db.products.bulkPut(prods);

          setProducts(prods);
        }
      } catch (err) {
        console.error("[useOfflineProducts] Error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [categoryId]);

  return { products, loading };
}

/**
 * Hook to check online status
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

/**
 * Save order offline-first
 * Saves to Dexie first, syncs to Supabase if online
 */
export async function saveOrderOfflineFirst(
  order: any,
  items: any[]
): Promise<{ orderId: string; synced: boolean }> {
  const orderId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  // Always save to Dexie first
  const dbOrder = {
    id: orderId,
    shift_id: order.shift_id,
    outlet_id: order.outlet_id,
    cashier_id: order.cashier_id,
    service_mode: order.service_mode,
    platform_name: order.platform_name,
    platform_order_id: order.platform_order_id,
    total: order.total,
    discount: order.discount || 0,
    final_total: order.final_total,
    payment_method: order.payment_method,
    amount_paid: order.amount_paid,
    change_amount: order.change_amount,
    status: order.status || "completed",
    created_at: now,
  };

  const dbItems = items.map((item: any) => ({
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    order_id: orderId,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: item.unit_price,
    discount: item.discount || 0,
    subtotal: item.subtotal,
  }));

  await saveOrderLocal(dbOrder, dbItems);

  // Online payments use one database transaction. Network failures keep the
  // local order for retry; business failures (for example insufficient stock)
  // are surfaced to the cashier and removed from the pending queue.
  if (navigator.onLine) {
    try {
      const remoteOrderId = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-0000-0000-0000-000000000000`;
      const { data: savedOrderId, error } = await supabase.rpc("complete_order_transaction", {
        p_order_id: remoteOrderId,
        p_outlet_id: order.outlet_id,
        p_cashier_id: order.cashier_id,
        p_shift_id: order.shift_id || null,
        p_service_mode: order.service_mode,
        p_platform_name: order.platform_name || null,
        p_platform_order_id: order.platform_order_id || null,
        p_total: order.total,
        p_discount: order.discount || 0,
        p_final_total: order.final_total,
        p_payment_method: order.payment_method,
        p_amount_paid: order.amount_paid || 0,
        p_change_amount: order.change_amount || 0,
        p_items: items,
        p_notes: order.notes || null,
      });
      if (error) throw error;
      await removeLocalOrder(orderId);
      return { orderId: String(savedOrderId || remoteOrderId), synced: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isMissingAtomicFunction = /function.*does not exist|complete_order_transaction/i.test(message);
      if (isMissingAtomicFunction) {
        throw new Error("Database belum menjalankan migration-atomic-payment.sql");
      }
      const isBusinessFailure = /stok|jumlah|pembayaran|total transaksi/i.test(message);
      if (isBusinessFailure) {
        await removeLocalOrder(orderId);
        throw new Error(message);
      }
      console.error("[OfflineFirst] Atomic payment unavailable, will retry:", err);
    }
  }

  return { orderId, synced: false };
}
