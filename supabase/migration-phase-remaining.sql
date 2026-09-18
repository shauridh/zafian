-- Remaining phase foundations: split payments, reorder workflow, customer timeline.

CREATE TABLE IF NOT EXISTS split_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash','qris','card')),
  amount INT NOT NULL CHECK (amount > 0),
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','partial','received','cancelled')),
  supplier TEXT,
  notes TEXT,
  total_estimate INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price INT NOT NULL DEFAULT 0,
  received_quantity NUMERIC(14,3) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_order_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_order_id UUID NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_customer_order_status(
  p_order_id UUID, p_status TEXT, p_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE customer_orders SET status = p_status, status_note = p_note, status_updated_at = now() WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer order tidak ditemukan'; END IF;
  INSERT INTO customer_order_status_history(customer_order_id, status, note) VALUES(p_order_id, p_status, p_note);
END;
$$;

ALTER TABLE split_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_order_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on split_payments" ON split_payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on purchase_orders" ON purchase_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on purchase_order_items" ON purchase_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on customer_order_status_history" ON customer_order_status_history FOR ALL USING (true) WITH CHECK (true);
