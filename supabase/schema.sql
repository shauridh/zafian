-- ============================================
-- SABANA FRIED CHICKEN POS — Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. OUTLETS (no dependencies)
-- ============================================
CREATE TABLE outlets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  is_active BOOLEAN DEFAULT true
);

-- ============================================
-- 2. USERS (depends on: outlets)
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  role TEXT CHECK (role IN ('cashier', 'admin', 'manager', 'customer')),
  outlet_id UUID REFERENCES outlets(id),
  pin TEXT,
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 3. CATEGORIES (no dependencies)
-- ============================================
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 4. PRODUCTS (depends on: categories)
-- ============================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT,
  price INT NOT NULL,
  hpp INT,
  cost_price INT,
  sku TEXT UNIQUE,
  image_url TEXT,
  unit TEXT DEFAULT 'pcs',
  is_active BOOLEAN DEFAULT true,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 5. INGREDIENTS (no dependencies)
-- ============================================
CREATE TABLE ingredients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT NOT NULL,
  purchase_unit TEXT,
  usage_unit TEXT,
  conversion_factor NUMERIC(12,4) DEFAULT 1,
  purchase_price INT NOT NULL,
  stock_quantity INT DEFAULT 0,
  min_stock INT DEFAULT 0,
  supplier TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 6. PRODUCT INGREDIENTS (depends on: products, ingredients)
-- ============================================
CREATE TABLE product_ingredients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id),
  quantity DECIMAL(10,3) NOT NULL,
  usage_unit TEXT,
  cost_per_unit INT NOT NULL,
  notes TEXT
);

-- ============================================
-- 7. PRODUCTION RECIPES (no dependencies)
-- ============================================
CREATE TABLE production_recipes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE recipe_inputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID REFERENCES production_recipes(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id),
  quantity DECIMAL(10,3) NOT NULL
);

CREATE TABLE recipe_outputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID REFERENCES production_recipes(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INT NOT NULL
);

-- ============================================
-- 8. SHIFTS (depends on: outlets, users)
-- ============================================
CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID REFERENCES outlets(id),
  cashier_id UUID REFERENCES users(id),
  status TEXT CHECK (status IN ('active', 'closed')),
  opening_float INT NOT NULL DEFAULT 350000,
  closing_cash INT,
  expected_cash INT,
  cash_diff INT,
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  notes TEXT
);

-- ============================================
-- 9. BUNDLES (no dependencies)
-- ============================================
CREATE TABLE bundles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  price INT NOT NULL,
  original_price INT,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE bundle_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bundle_id UUID REFERENCES bundles(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INT DEFAULT 1
);

-- ============================================
-- 10. ORDERS (depends on: outlets, users, shifts)
-- ============================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number SERIAL,
  outlet_id UUID REFERENCES outlets(id),
  cashier_id UUID REFERENCES users(id),
  shift_id UUID REFERENCES shifts(id),
  service_mode TEXT CHECK (service_mode IN ('dine_in', 'take_away', 'gofood', 'grabfood', 'shopeefood', 'delivery')),
  platform_name TEXT,
  platform_order_id TEXT,
  estimated_amount INT,
  total INT NOT NULL,
  discount INT DEFAULT 0,
  discount_type TEXT,
  discount_value INT DEFAULT 0,
  final_total INT NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('cash', 'qris', 'card', 'estimate')),
  amount_paid INT,
  change_amount INT,
  status TEXT DEFAULT 'completed',
  synced BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 11. ORDER ITEMS (depends on: orders, products, bundles)
-- ============================================
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  bundle_id UUID REFERENCES bundles(id),
  quantity INT NOT NULL,
  unit_price INT NOT NULL,
  discount INT DEFAULT 0,
  subtotal INT NOT NULL
);

-- ============================================
-- 12. PRODUCTION ORDERS (depends on: outlets, users, production_recipes)
-- ============================================
CREATE TABLE production_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID REFERENCES outlets(id),
  recipe_id UUID REFERENCES production_recipes(id),
  produced_by UUID REFERENCES users(id),
  input_quantity INT NOT NULL,
  status TEXT CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ============================================
-- 13. FINISHED GOODS (depends on: products, outlets)
-- ============================================
CREATE TABLE finished_goods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id),
  outlet_id UUID REFERENCES outlets(id),
  quantity INT NOT NULL DEFAULT 0,
  min_quantity INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(product_id, outlet_id)
);

-- ============================================
-- 14. STOCK LEDGER (depends on: ingredients, products, outlets, users)
-- ============================================
CREATE TABLE stock_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingredient_id UUID REFERENCES ingredients(id),
  product_id UUID REFERENCES products(id),
  type TEXT CHECK (type IN ('in', 'out', 'production_in', 'production_out', 'sale', 'adjustment')),
  quantity INT NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  notes TEXT,
  outlet_id UUID REFERENCES outlets(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 15. CASHFLOW (depends on: outlets, shifts, users)
-- ============================================
CREATE TABLE cashflow_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID REFERENCES outlets(id),
  shift_id UUID REFERENCES shifts(id),
  type TEXT CHECK (type IN ('income', 'expense')),
  category TEXT,
  amount INT NOT NULL,
  description TEXT,
  payment_method TEXT CHECK (payment_method IN ('cash', 'qris', 'transfer')),
  recorded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 16. PROMOS (depends on: products, bundles)
-- ============================================
CREATE TABLE promos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('percentage', 'fixed', 'bundle')),
  value INT,
  min_purchase INT DEFAULT 0,
  product_id UUID REFERENCES products(id),
  bundle_id UUID REFERENCES bundles(id),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 17. LOYALTY (no dependencies)
-- ============================================
CREATE TABLE loyalty_customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  points INT DEFAULT 0,
  stamps INT DEFAULT 0,
  total_spent INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES loyalty_customers(id),
  order_id UUID REFERENCES orders(id),
  points_earned INT DEFAULT 0,
  points_redeemed INT DEFAULT 0,
  stamps_earned INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 18. CUSTOMER ORDERS (depends on: outlets, loyalty_customers)
-- ============================================
CREATE TABLE customer_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number SERIAL,
  customer_id UUID REFERENCES loyalty_customers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT NOT NULL,
  customer_notes TEXT,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  total INT NOT NULL,
  delivery_fee INT DEFAULT 0,
  discount INT DEFAULT 0,
  final_total INT NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('cash', 'qris')),
  status TEXT DEFAULT 'pending',
  outlet_id UUID REFERENCES outlets(id),
  estimated_delivery TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE customer_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_order_id UUID REFERENCES customer_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  bundle_id UUID REFERENCES bundles(id),
  quantity INT NOT NULL,
  unit_price INT NOT NULL,
  subtotal INT NOT NULL
);

-- ============================================
-- 19. DAILY RECONCILIATION (depends on: outlets, shifts)
-- ============================================
CREATE TABLE daily_reconciliation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID REFERENCES outlets(id),
  shift_id UUID REFERENCES shifts(id) UNIQUE,
  total_sales_cash INT DEFAULT 0,
  total_sales_qris INT DEFAULT 0,
  total_sales_online INT DEFAULT 0,
  total_expenses INT DEFAULT 0,
  total_income INT DEFAULT 0,
  gross_profit INT DEFAULT 0,
  opening_float INT DEFAULT 350000,
  closing_cash INT DEFAULT 0,
  cash_diff INT DEFAULT 0,
  reconciled_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 20. INVENTORY FORECASTING (depends on: outlets, products, ingredients)
-- ============================================
CREATE TABLE inventory_forecasts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID REFERENCES outlets(id),
  product_id UUID REFERENCES products(id),
  ingredient_id UUID REFERENCES ingredients(id),
  forecast_date DATE NOT NULL,
  predicted_demand INT NOT NULL,
  current_stock INT NOT NULL,
  suggested_reorder INT DEFAULT 0,
  confidence DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ============================================
-- RLS POLICIES (Allow anon access for POS app)
-- ============================================
ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE finished_goods ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashflow_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_forecasts ENABLE ROW LEVEL SECURITY;

-- Allow all operations for anon role (POS app)
CREATE POLICY "Allow all on outlets" ON outlets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on categories" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ingredients" ON ingredients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on product_ingredients" ON product_ingredients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on production_recipes" ON production_recipes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on recipe_inputs" ON recipe_inputs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on recipe_outputs" ON recipe_outputs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on shifts" ON shifts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on bundles" ON bundles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on bundle_items" ON bundle_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on orders" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on order_items" ON order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on production_orders" ON production_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on finished_goods" ON finished_goods FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on stock_ledger" ON stock_ledger FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on cashflow_entries" ON cashflow_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on promos" ON promos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on loyalty_customers" ON loyalty_customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on loyalty_transactions" ON loyalty_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on customer_orders" ON customer_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on customer_order_items" ON customer_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on daily_reconciliation" ON daily_reconciliation FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on inventory_forecasts" ON inventory_forecasts FOR ALL USING (true) WITH CHECK (true);

-- SEED DATA
-- ============================================

-- Default Outlet
INSERT INTO outlets (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Sabana Outlet Utama', 'Jl. Contoh No. 123', '0812-xxxx-xxxx');

-- Categories
INSERT INTO categories (id, name, icon, color, sort_order) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Ayam Goreng', '🍗', '#EA580C', 1),
  ('10000000-0000-0000-0000-000000000002', 'Nasi', '🍚', '#16A34A', 2),
  ('10000000-0000-0000-0000-000000000003', 'Rice Bowl', '🍱', '#7C3AED', 3),
  ('10000000-0000-0000-0000-000000000004', 'Sambal & Saus', '🥘', '#DC2626', 4),
  ('10000000-0000-0000-0000-000000000005', 'Side Menu', '🍢', '#2563EB', 5),
  ('10000000-0000-0000-0000-000000000006', 'Burger & Bun', '🍔', '#D97706', 6),
  ('10000000-0000-0000-0000-000000000007', 'Minuman', '🥤', '#0891B2', 7),
  ('10000000-0000-0000-0000-000000000008', 'Paket', '📦', '#BE185D', 8);

-- Users (single admin account)
INSERT INTO users (id, name, role, outlet_id, pin) VALUES
  ('30000000-0000-0000-0000-000000000001', 'Sabana', 'admin', '00000000-0000-0000-0000-000000000001', '080802');

-- Products (33 items dari Excel HPP Reguler)
INSERT INTO products (id, category_id, name, price, hpp, unit, sku) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ayam Reguler (9 potong)', 89000, 63711, 'porsi', 'AYM-REG'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Ayam SBP (9 potong)', 89000, 73711, 'porsi', 'AYM-SBP'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Dada', 11000, NULL, 'pcs', 'AYM-DAD'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Paha Atas', 11000, NULL, 'pcs', 'AYM-PAT'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Paha Bawah', 9000, NULL, 'pcs', 'AYM-PAB'),
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'Sayap', 8000, NULL, 'pcs', 'AYM-SAY'),
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000002', 'Nasi Putih', 5000, 1333, 'porsi', 'NSI-PUT'),
  ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000003', 'RB Sambal Geprek 650ml', 15000, 12323, 'porsi', 'RBG-650'),
  ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000003', 'RB BBQ Sauce 650ml', 15000, 11722, 'porsi', 'RBB-650'),
  ('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000003', 'RB Katsu 650ml', 15000, 10387, 'porsi', 'RBK-650'),
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000003', 'RB Sambal Geprek 500ml', 12000, 9717, 'porsi', 'RBG-500'),
  ('20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000003', 'RB BBQ Sauce 500ml', 12000, 8993, 'porsi', 'RBB-500'),
  ('20000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000004', 'Sambal Geprek', 4000, 2482, 'cup', 'SMB-GEP'),
  ('20000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000004', 'Sambal Hitam', 4000, 2272, 'cup', 'SMB-HIT'),
  ('20000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000004', 'Sambal Ijo', 4000, 2478, 'cup', 'SMB-IJO'),
  ('20000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000004', 'Saos Buldak', 3000, 1724, 'cup', 'SAO-BUL'),
  ('20000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000004', 'Saos Mentai', 2000, 1276, 'cup', 'SAO-MEN'),
  ('20000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000004', 'Saos Sadas', 3000, 1232, 'cup', 'SAO-SAD'),
  ('20000000-0000-0000-0000-000000000019', '10000000-0000-0000-0000-000000000005', 'Chicken Roll', 4000, 3527, 'tusuk', 'SID-CRL'),
  ('20000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000005', 'Bakso', 4000, 3584, 'tusuk', 'SID-BAK'),
  ('20000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000005', 'Chicken Strip', 4000, 3439, 'tusuk', 'SID-STR'),
  ('20000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000005', 'Kulit Crispy', 5000, 3671, 'porsi', 'SID-KUL'),
  ('20000000-0000-0000-0000-000000000023', '10000000-0000-0000-0000-000000000005', 'Chicken Katsu', 8000, 5816, 'pcs', 'SID-KAT'),
  ('20000000-0000-0000-0000-000000000024', '10000000-0000-0000-0000-000000000005', 'Kentang Goreng', 8000, 6709, 'porsi', 'SID-KNT'),
  ('20000000-0000-0000-0000-000000000025', '10000000-0000-0000-0000-000000000006', 'Burger', 12000, 10199, 'pcs', 'BRG-REG'),
  ('20000000-0000-0000-0000-000000000026', '10000000-0000-0000-0000-000000000006', 'Chicken Bun', 10000, 6718, 'pcs', 'BRG-CBN'),
  ('20000000-0000-0000-0000-000000000027', '10000000-0000-0000-0000-000000000007', 'Fruit Tea Apple', 3000, NULL, 'botol', 'MNM-FTA'),
  ('20000000-0000-0000-0000-000000000028', '10000000-0000-0000-0000-000000000007', 'Fruit Tea Blackcurrant', 3000, NULL, 'botol', 'MNM-FTB'),
  ('20000000-0000-0000-0000-000000000029', '10000000-0000-0000-0000-000000000007', 'Fruit Tea Lemon', 3000, NULL, 'botol', 'MNM-FTL'),
  ('20000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000007', 'Teh Sosro', 3000, NULL, 'botol', 'MNM-TSO'),
  ('20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000007', 'Air Mineral', 3000, NULL, 'botol', 'MNM-AIR'),
  ('20000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000008', 'Paket Nasi Ayam', 95000, NULL, 'paket', 'PKT-NSA'),
  ('20000000-0000-0000-0000-000000000033', '10000000-0000-0000-0000-000000000008', 'Paket Komplit', 115000, NULL, 'paket', 'PKT-KMP');

-- Production Recipes
INSERT INTO production_recipes (id, name, description) VALUES
  ('40000000-0000-0000-0000-000000000001', 'Ayam Reguler → 9 Potong', 'Konversi 1 ekor ayam utuh menjadi 9 potong siap jual');

INSERT INTO recipe_outputs (recipe_id, product_id, quantity) VALUES
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 3),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 2),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', 2),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 2);
