-- Sabana POS Phase 1-5 operational foundations
-- Run after schema.sql and previous migrations.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS sync_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_sync_error TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS sync_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS last_sync_error TEXT;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE ingredients ALTER COLUMN stock_quantity TYPE NUMERIC(14,3) USING stock_quantity::NUMERIC;
ALTER TABLE stock_ledger ALTER COLUMN quantity TYPE NUMERIC(14,3) USING quantity::NUMERIC;

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID REFERENCES outlets(id),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_opnames (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stock_opname_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  opname_id UUID NOT NULL REFERENCES stock_opnames(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  ingredient_id UUID REFERENCES ingredients(id),
  system_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  counted_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  difference NUMERIC(14,3) GENERATED ALWAYS AS (counted_quantity - system_quantity) STORED,
  UNIQUE(opname_id, product_id, ingredient_id),
  CHECK ((product_id IS NULL) <> (ingredient_id IS NULL))
);

CREATE TABLE IF NOT EXISTS saved_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id),
  shift_id UUID REFERENCES shifts(id),
  cashier_id UUID REFERENCES users(id),
  label TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS status_note TEXT;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS platform_order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_shift_status ON orders(shift_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_sync_status ON orders(synced, last_sync_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(status, status_updated_at DESC);

CREATE OR REPLACE FUNCTION complete_production(
  p_outlet_id UUID,
  p_recipe_id UUID,
  p_batch_quantity NUMERIC,
  p_actor_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_order_id UUID := uuid_generate_v4();
  v_input RECORD;
  v_output RECORD;
  v_required NUMERIC;
  v_stock NUMERIC;
BEGIN
  IF p_batch_quantity <= 0 THEN RAISE EXCEPTION 'Batch quantity harus lebih besar dari 0'; END IF;

  FOR v_input IN
    SELECT ri.ingredient_id, ri.quantity, i.name
    FROM recipe_inputs ri JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id = p_recipe_id AND i.is_active = true
    FOR UPDATE OF i
  LOOP
    v_required := v_input.quantity * p_batch_quantity;
    SELECT stock_quantity INTO v_stock FROM ingredients WHERE id = v_input.ingredient_id;
    IF COALESCE(v_stock, 0) < v_required THEN
      RAISE EXCEPTION 'Stok bahan % tidak cukup (butuh %, tersedia %)', v_input.name, v_required, COALESCE(v_stock, 0);
    END IF;
  END LOOP;

  INSERT INTO production_orders(outlet_id, recipe_id, produced_by, input_quantity, status, notes, completed_at)
  VALUES(p_outlet_id, p_recipe_id, p_actor_id, p_batch_quantity, 'completed', p_notes, now())
  RETURNING id INTO v_order_id;

  FOR v_input IN SELECT ri.ingredient_id, ri.quantity FROM recipe_inputs ri WHERE ri.recipe_id = p_recipe_id LOOP
    v_required := v_input.quantity * p_batch_quantity;
    UPDATE ingredients SET stock_quantity = stock_quantity - v_required WHERE id = v_input.ingredient_id;
    INSERT INTO stock_ledger(ingredient_id, type, quantity, reference_type, reference_id, notes, outlet_id, created_by)
    VALUES(v_input.ingredient_id, 'production_out', -v_required, 'production_order', v_order_id, 'Pemakaian produksi', p_outlet_id, p_actor_id);
  END LOOP;

  FOR v_output IN SELECT ro.product_id, ro.quantity FROM recipe_outputs ro WHERE ro.recipe_id = p_recipe_id LOOP
    INSERT INTO finished_goods(product_id, outlet_id, quantity, min_quantity, updated_at)
    VALUES(v_output.product_id, p_outlet_id, v_output.quantity * p_batch_quantity, 10, now())
    ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = finished_goods.quantity + EXCLUDED.quantity, updated_at = now();
    INSERT INTO stock_ledger(product_id, type, quantity, reference_type, reference_id, notes, outlet_id, created_by)
    VALUES(v_output.product_id, 'production_in', v_output.quantity * p_batch_quantity, 'production_order', v_order_id, 'Hasil produksi', p_outlet_id, p_actor_id);
  END LOOP;

  INSERT INTO audit_logs(outlet_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES(p_outlet_id, p_actor_id, 'production.completed', 'production_order', v_order_id, jsonb_build_object('recipe_id', p_recipe_id, 'batch_quantity', p_batch_quantity));
  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION post_stock_opname(p_opname_id UUID, p_actor_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_opname RECORD; v_item RECORD;
BEGIN
  SELECT * INTO v_opname FROM stock_opnames WHERE id = p_opname_id FOR UPDATE;
  IF v_opname.status <> 'draft' THEN RAISE EXCEPTION 'Opname sudah diposting atau dibatalkan'; END IF;
  FOR v_item IN SELECT * FROM stock_opname_items WHERE opname_id = p_opname_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      INSERT INTO finished_goods(product_id, outlet_id, quantity, min_quantity, updated_at)
      VALUES(v_item.product_id, v_opname.outlet_id, v_item.counted_quantity, 0, now())
      ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
      INSERT INTO stock_ledger(product_id, type, quantity, reference_type, reference_id, notes, outlet_id, created_by)
      VALUES(v_item.product_id, 'adjustment', v_item.difference, 'stock_opname', p_opname_id, 'Posting opname', v_opname.outlet_id, p_actor_id);
    ELSE
      UPDATE ingredients SET stock_quantity = v_item.counted_quantity WHERE id = v_item.ingredient_id;
      INSERT INTO stock_ledger(ingredient_id, type, quantity, reference_type, reference_id, notes, outlet_id, created_by)
      VALUES(v_item.ingredient_id, 'adjustment', v_item.difference, 'stock_opname', p_opname_id, 'Posting opname', v_opname.outlet_id, p_actor_id);
    END IF;
  END LOOP;
  UPDATE stock_opnames SET status = 'posted', posted_at = now() WHERE id = p_opname_id;
  INSERT INTO audit_logs(outlet_id, actor_id, action, entity_type, entity_id)
  VALUES(v_opname.outlet_id, p_actor_id, 'stock_opname.posted', 'stock_opname', p_opname_id);
END;
$$;

CREATE OR REPLACE VIEW product_margin_summary AS
SELECT p.id, p.name, p.sku, p.price, COALESCE(p.hpp, p.cost_price, 0) AS hpp,
       p.price - COALESCE(p.hpp, p.cost_price, 0) AS margin,
       CASE WHEN p.price > 0 THEN ROUND(((p.price - COALESCE(p.hpp, p.cost_price, 0))::NUMERIC / p.price) * 100, 2) ELSE 0 END AS margin_percent
FROM products p WHERE p.is_active = true;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_opnames ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_opname_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on audit_logs" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on stock_opnames" ON stock_opnames FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on stock_opname_items" ON stock_opname_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on saved_orders" ON saved_orders FOR ALL USING (true) WITH CHECK (true);
