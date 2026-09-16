/**
 * Dexie.js Offline Database
 * Stores data locally for offline POS operation
 * Syncs to Supabase when online
 */
import Dexie, { type Table } from "dexie";

// ---------- Type Definitions ----------

export interface DBCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
}

export interface DBProduct {
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
}

export interface DBUser {
  id: string;
  name: string;
  role: string;
  outlet_id: string;
  pin?: string;
  is_active: boolean;
}

export interface DBShift {
  id: string;
  outlet_id: string;
  cashier_id: string;
  cashier_name: string;
  status: "active" | "closed";
  opening_float: number;
  closing_cash?: number;
  expected_cash?: number;
  cash_diff?: number;
  opened_at: string;
  closed_at?: string;
  notes?: string;
  synced: boolean;
}

export interface DBOrder {
  id: string;
  shift_id?: string;
  outlet_id: string;
  cashier_id: string;
  service_mode: string;
  platform_name?: string;
  platform_order_id?: string;
  total: number;
  discount: number;
  final_total: number;
  payment_method: string;
  amount_paid: number;
  change_amount: number;
  status: string;
  synced: boolean;
  created_at: string;
}

export interface DBOrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  discount: number;
  subtotal: number;
  synced: boolean;
}

export interface DBFinishedGood {
  product_id: string;
  outlet_id: string;
  quantity: number;
  min_quantity: number;
  updated_at: string;
}

// ---------- Database Schema ----------

class SabanaDatabase extends Dexie {
  categories!: Table<DBCategory>;
  products!: Table<DBProduct>;
  users!: Table<DBUser>;
  shifts!: Table<DBShift>;
  orders!: Table<DBOrder>;
  orderItems!: Table<DBOrderItem>;
  finishedGoods!: Table<DBFinishedGood>;

  constructor() {
    super("SabanaPOS");

    this.version(1).stores({
      categories: "id, sort_order, is_active",
      products: "id, category_id, name, sku, is_active",
      users: "id, role, is_active",
      shifts: "id, status, cashier_id, synced, opened_at",
      orders: "id, shift_id, status, synced, created_at, payment_method",
      orderItems: "id, order_id, product_id, synced",
      finishedGoods: "[product_id+outlet_id], product_id",
    });
  }
}

export const db = new SabanaDatabase();

// ---------- Helper Functions ----------

/**
 * Seed local database from Supabase data
 */
export async function seedFromSupabase(supabaseClient: any) {
  try {
    // Fetch all data from Supabase
    const [catRes, prodRes, userRes] = await Promise.all([
      supabaseClient.from("categories").select("*").eq("is_active", true),
      supabaseClient.from("products").select("*").eq("is_active", true),
      supabaseClient.from("users").select("*").eq("is_active", true),
    ]);

    // Bulk put into Dexie
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

    if (userRes.data) {
      await db.users.clear();
      await db.users.bulkPut(
        userRes.data.map((u: any) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          outlet_id: u.outlet_id,
          pin: u.pin,
          is_active: u.is_active,
        }))
      );
    }

    console.log("[Dexie] Seed from Supabase complete");
    return true;
  } catch (err) {
    console.error("[Dexie] Seed error:", err);
    return false;
  }
}

/**
 * Save an order locally (offline-safe)
 */
export async function saveOrderLocal(order: Omit<DBOrder, "synced">, items: Omit<DBOrderItem, "synced">[]) {
  const orderId = order.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const fullOrder: DBOrder = { ...order, id: orderId, synced: false };
  const fullItems: DBOrderItem[] = items.map((item) => ({
    ...item,
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    order_id: orderId,
    synced: false,
  }));

  await db.transaction("rw", [db.orders, db.orderItems], async () => {
    await db.orders.put(fullOrder);
    await db.orderItems.bulkPut(fullItems);
  });

  return orderId;
}

/**
 * Save a shift locally
 */
export async function saveShiftLocal(shift: Omit<DBShift, "synced">) {
  const fullShift: DBShift = { ...shift, synced: false };
  await db.shifts.put(fullShift);
  return shift.id;
}

/**
 * Get all unsynced orders
 */
export async function getUnsyncedOrders() {
  return db.orders.where("synced").equals(0).toArray();
}

/**
 * Get all unsynced order items for an order
 */
export async function getUnsyncedOrderItems(orderId: string) {
  return db.orderItems.where({ order_id: orderId, synced: false }).toArray();
}

/**
 * Mark order as synced
 */
export async function markOrderSynced(orderId: string) {
  await db.orders.update(orderId, { synced: true });
  await db.orderItems.where("order_id").equals(orderId).modify({ synced: true });
}

/**
 * Mark shift as synced
 */
export async function markShiftSynced(shiftId: string) {
  await db.shifts.update(shiftId, { synced: true });
}

/**
 * Get active shift from local DB
 */
export async function getActiveShift() {
  return db.shifts.where("status").equals("active").first();
}

/**
 * Get today's orders from local DB
 */
export async function getTodayOrders() {
  const today = new Date().toISOString().split("T")[0];
  return db.orders.where("created_at").startsWith(today).toArray();
}
