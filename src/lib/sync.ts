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
        const orderItems = await db.orderItems
          .where("order_id")
          .equals(order.id)
          .and((item) => !item.synced)
          .toArray();
        const remoteOrderId = crypto.randomUUID();
        const { error: orderError } = await supabaseClient.rpc("complete_order_transaction", {
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
          p_items: orderItems,
          p_notes: null,
        });
        if (orderError) throw orderError;
        await db.transaction("rw", [db.orders, db.orderItems], async () => {
          await db.orderItems.where("order_id").equals(order.id).delete();
          await db.orders.delete(order.id);
        });
        synced++;
        console.log(`[Sync] Order ${order.id} synced`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.orders.update(order.id, {
          sync_status: "failed",
          sync_attempts: (order.sync_attempts || 0) + 1,
          last_sync_error: message,
          last_sync_at: new Date().toISOString(),
        });
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
        const message = err instanceof Error ? err.message : String(err);
        await db.shifts.update(shift.id, {
          sync_status: "failed",
          sync_attempts: (shift as any).sync_attempts ? (shift as any).sync_attempts + 1 : 1,
          last_sync_error: message,
          last_sync_at: new Date().toISOString(),
        } as any);
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
