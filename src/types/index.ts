// ============================================
// CATEGORY
// ============================================
export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

// ============================================
// PRODUCT
// ============================================
export interface Product {
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
  created_at: string;
  updated_at: string;
}

// ============================================
// INGREDIENT (Bahan Baku)
// ============================================
export interface Ingredient {
  id: string;
  name: string;
  sku?: string;
  unit: string;
  purchase_price: number;
  stock_quantity: number;
  min_stock: number;
  supplier?: string;
  is_active: boolean;
  created_at: string;
}

// ============================================
// PRODUCT INGREDIENTS (Recipe)
// ============================================
export interface ProductIngredient {
  id: string;
  product_id: string;
  ingredient_id: string;
  quantity: number;
  cost_per_unit: number;
}

// ============================================
// PRODUCTION RECIPES
// ============================================
export interface ProductionRecipe {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
}

export interface RecipeInput {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  quantity: number;
}

export interface RecipeOutput {
  id: string;
  recipe_id: string;
  product_id: string;
  quantity: number;
}

// ============================================
// PRODUCTION ORDERS
// ============================================
export interface ProductionOrder {
  id: string;
  outlet_id: string;
  recipe_id: string;
  produced_by: string;
  input_quantity: number;
  status: "draft" | "in_progress" | "completed" | "cancelled";
  notes?: string;
  created_at: string;
  completed_at?: string;
}

// ============================================
// FINISHED GOODS STOCK
// ============================================
export interface FinishedGoods {
  id: string;
  product_id: string;
  outlet_id: string;
  quantity: number;
  min_quantity: number;
  updated_at: string;
}

// ============================================
// STOCK LEDGER
// ============================================
export interface StockLedger {
  id: string;
  ingredient_id?: string;
  product_id?: string;
  type: "in" | "out" | "production_in" | "production_out" | "sale" | "adjustment";
  quantity: number;
  reference_type?: string;
  reference_id?: string;
  notes?: string;
  outlet_id: string;
  created_by: string;
  created_at: string;
}

// ============================================
// OUTLET
// ============================================
export interface Outlet {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  is_active: boolean;
}

// ============================================
// USER
// ============================================
export interface User {
  id: string;
  name: string;
  role: "cashier" | "admin" | "manager" | "customer";
  outlet_id?: string;
  pin?: string;
  phone?: string;
  is_active: boolean;
  created_at: string;
}

// ============================================
// SHIFT
// ============================================
export interface Shift {
  id: string;
  outlet_id: string;
  cashier_id: string;
  status: "active" | "closed";
  opening_float: number;
  closing_cash?: number;
  expected_cash?: number;
  cash_diff?: number;
  opened_at: string;
  closed_at?: string;
  notes?: string;
}

// ============================================
// ORDER (Transaksi Kasir)
// ============================================
export type ServiceMode = "dine_in" | "take_away" | "gofood" | "grabfood" | "shopeefood" | "delivery";
export type PaymentMethod = "cash" | "qris" | "card";

export interface Order {
  id: string;
  order_number: number;
  outlet_id: string;
  cashier_id: string;
  shift_id?: string;
  service_mode: ServiceMode;
  platform_name?: string;
  platform_order_id?: string;
  estimated_amount?: number;
  total: number;
  discount: number;
  discount_type?: "percentage" | "fixed";
  discount_value: number;
  final_total: number;
  payment_method: PaymentMethod;
  amount_paid?: number;
  change_amount?: number;
  status: "completed" | "pending" | "cancelled";
  synced: boolean;
  notes?: string;
  created_at: string;
}

// ============================================
// ORDER ITEM
// ============================================
export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  bundle_id?: string;
  quantity: number;
  unit_price: number;
  discount: number;
  subtotal: number;
}

// ============================================
// BUNDLE (Paket)
// ============================================
export interface Bundle {
  id: string;
  name: string;
  description?: string;
  price: number;
  original_price?: number;
  image_url?: string;
  is_active: boolean;
  created_at: string;
}

export interface BundleItem {
  id: string;
  bundle_id: string;
  product_id: string;
  quantity: number;
}

// ============================================
// CASHFLOW
// ============================================
export type CashflowType = "income" | "expense";
export type CashflowCategory =
  | "sales_cash" | "sales_qris" | "sales_gofood" | "sales_grabfood" | "sales_shopeefood" | "other_income"
  | "ingredients" | "supplies" | "utilities" | "salary" | "rent" | "maintenance" | "other_expense";

export interface CashflowEntry {
  id: string;
  outlet_id: string;
  shift_id?: string;
  type: CashflowType;
  category: CashflowCategory;
  amount: number;
  description?: string;
  payment_method?: "cash" | "qris" | "transfer";
  recorded_by: string;
  created_at: string;
}

// ============================================
// PROMO
// ============================================
export interface Promo {
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

// ============================================
// LOYALTY
// ============================================
export interface LoyaltyCustomer {
  id: string;
  phone: string;
  name?: string;
  points: number;
  stamps: number;
  total_spent: number;
  created_at: string;
}

export interface LoyaltyTransaction {
  id: string;
  customer_id: string;
  order_id?: string;
  points_earned: number;
  points_redeemed: number;
  stamps_earned: number;
  created_at: string;
}

// ============================================
// CUSTOMER ORDER (Portal Delivery)
// ============================================
export type CustomerOrderStatus = "pending" | "confirmed" | "preparing" | "delivering" | "completed";

export interface CustomerOrder {
  id: string;
  order_number: number;
  customer_id?: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_notes?: string;
  latitude?: number;
  longitude?: number;
  total: number;
  delivery_fee: number;
  discount: number;
  final_total: number;
  payment_method: "cash" | "qris";
  status: CustomerOrderStatus;
  outlet_id: string;
  estimated_delivery?: string;
  created_at: string;
}

// ============================================
// CART ITEM (Local State)
// ============================================
export interface CartItem {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  image_url?: string;
  bundle_id?: string;
  is_bundle?: boolean;
}

// ============================================
// SHIFT SUMMARY (Computed)
// ============================================
export interface ShiftSummary {
  shift: Shift;
  total_sales: number;
  total_sales_cash: number;
  total_sales_qris: number;
  total_sales_online: number;
  total_transactions: number;
  expected_cash: number;
  actual_cash: number;
  cash_diff: number;
}

// ============================================
// DASHBOARD STATS
// ============================================
export interface DashboardStats {
  total_transactions: number;
  total_revenue: number;
  total_profit: number;
  top_products: { name: string; quantity: number; revenue: number }[];
  sales_by_category: { name: string; amount: number }[];
  sales_by_payment: { method: string; amount: number }[];
  recent_orders: Order[];
  stock_alerts: { product: string; current: number; min: number }[];
}

// ============================================
// RECEIPT DATA
// ============================================
export interface ReceiptData {
  order: Order;
  items: (OrderItem & { product_name: string })[];
  outlet: Outlet;
  cashier_name: string;
  shift_id?: string;
}
