/**
 * Sync Service
 * Pushes local Dexie data to Supabase when online
 * Runs in background, non-blocking
 */
import { db, markOrderSynced, markShiftSynced } from "./db";

let supabaseClient: any = null;

export function setSupabaseClient(client: any) {
  supabaseClient = client;
}

/**
 * Sync all unsynced data to Supabase
 * Called automatically when device comes online
 */
export async function syncToSupabase(): Promise<{ synced: number; errors: number }> {
  if (!supabaseClient) {
    console.warn("[Sync] No Supabase client set");
    return { synced: 0, errors: 0 };
  }

  if (!navigator.onLine) {
    console.log("[Sync] Offline — skipping sync");
    return { synced: 0, errors: 0 };
  }

  let synced = 0;
  let errors = 0;

  try {
    // 1. Sync unsynced orders
    const unsyncedOrders = await db.orders.where("synced").equals(0).toArray();
    
    for (const order of unsyncedOrders) {
      try {
        // Skip local-only IDs (start with "local-")
        const isLocalId = order.id.startsWith("local-");
        
        const orderPayload = {
          id: isLocalId ? undefined : order.id, // Let Supabase generate UUID for local orders
          outlet_id: order.outlet_id,
          cashier_id: order.cashier_id,
          shift_id: order.shift_id || null,
          service_mode: order.service_mode,
          platform_name: order.platform_name,
          platform_order_id: order.platform_order_id,
          total: order.total,
          discount: order.discount,
          final_total: order.final_total,
          payment_method: order.payment_method,
          amount_paid: order.amount_paid,
          change_amount: order.change_amount,
          status: order.status,
          created_at: order.created_at,
        };

        const { data: savedOrder, error: orderError } = await supabaseClient
          .from("orders")
          .upsert(orderPayload, { onConflict: "id" })
          .select()
          .single();

        if (orderError) throw orderError;

        // Sync order items
        const orderItems = await db.orderItems
          .where("order_id")
          .equals(order.id)
          .and((item) => !item.synced)
          .toArray();

        if (orderItems.length > 0) {
          const itemsPayload = orderItems.map((item) => ({
            order_id: savedOrder?.id || order.id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount: item.discount,
            subtotal: item.subtotal,
          }));

          const { error: itemsError } = await supabaseClient
            .from("order_items")
            .upsert(itemsPayload);

          if (itemsError) throw itemsError;
        }

        // Mark as synced
        await markOrderSynced(order.id);
        synced++;
        console.log(`[Sync] Order ${order.id} synced`);
      } catch (err) {
        console.error(`[Sync] Failed to sync order ${order.id}:`, err);
        errors++;
      }
    }

    // 2. Sync unsynced shifts
    const unsyncedShifts = await db.shifts.where("synced").equals(0).toArray();
    
    for (const shift of unsyncedShifts) {
      try {
        const isLocalId = shift.id.startsWith("local-");
        
        const shiftPayload = {
          id: isLocalId ? undefined : shift.id,
          outlet_id: shift.outlet_id,
          cashier_id: shift.cashier_id,
          status: shift.status,
          opening_float: shift.opening_float,
          closing_cash: shift.closing_cash,
          expected_cash: shift.expected_cash,
          cash_diff: shift.cash_diff,
          opened_at: shift.opened_at,
          closed_at: shift.closed_at,
          notes: shift.notes,
        };

        const { error: shiftError } = await supabaseClient
          .from("shifts")
          .upsert(shiftPayload, { onConflict: "id" });

        if (shiftError) throw shiftError;

        await markShiftSynced(shift.id);
        synced++;
        console.log(`[Sync] Shift ${shift.id} synced`);
      } catch (err) {
        console.error(`[Sync] Failed to sync shift ${shift.id}:`, err);
        errors++;
      }
    }

    // 3. Pull fresh products/categories from Supabase
    try {
      const [catRes, prodRes] = await Promise.all([
        supabaseClient.from("categories").select("*").eq("is_active", true),
        supabaseClient.from("products").select("*").eq("is_active", true),
      ]);

      if (catRes.data) {
        await db.categories.clear();
        await db.categories.bulkPut(
          catRes.data.map((c: any) => ({
            id: c.id,
            name: c.name,
            icon: c.icon,
            color: c.color,
            sort_order: c.sort_order,
            is_active: c.is_active,
          }))
        );
      }

      if (prodRes.data) {
        await db.products.clear();
        await db.products.bulkPut(
          prodRes.data.map((p: any) => ({
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
          }))
        );
      }
    } catch (err) {
      console.error("[Sync] Failed to pull fresh data:", err);
    }

    console.log(`[Sync] Complete: ${synced} synced, ${errors} errors`);
  } catch (err) {
    console.error("[Sync] Sync failed:", err);
  }

  return { synced, errors };
}

/**
 * Auto-sync on reconnect
 */
let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(intervalMs = 30000) {
  // Sync immediately
  if (navigator.onLine && supabaseClient) {
    syncToSupabase();
  }

  // Listen for online event
  window.addEventListener("online", () => {
    console.log("[Sync] Back online — syncing...");
    if (supabaseClient) {
      syncToSupabase();
    }
  });

  // Periodic sync every N seconds
  syncInterval = setInterval(() => {
    if (navigator.onLine && supabaseClient) {
      syncToSupabase();
    }
  }, intervalMs);
}

export function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
