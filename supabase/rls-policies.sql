-- ============================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- This enables RLS and allows anon access
-- ============================================

-- Enable RLS on all tables
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
