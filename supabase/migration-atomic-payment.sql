-- Atomic cashier payment: order + items + stock + cashflow + audit in one transaction.
-- Run after migration-phase-1-5-foundations.sql.

CREATE OR REPLACE FUNCTION complete_order_transaction(
  p_order_id UUID,
  p_outlet_id UUID,
  p_cashier_id UUID,
  p_shift_id UUID,
  p_service_mode TEXT,
  p_platform_name TEXT,
  p_platform_order_id TEXT,
  p_total INT,
  p_discount INT,
  p_final_total INT,
  p_payment_method TEXT,
  p_amount_paid INT,
  p_change_amount INT,
  p_items JSONB,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item RECORD;
  v_available NUMERIC;
  v_order_id UUID := COALESCE(p_order_id, uuid_generate_v4());
BEGIN
  -- Safe retry: a repeated payment request cannot create a second sale.
  IF EXISTS (SELECT 1 FROM orders WHERE id = v_order_id) THEN
    RETURN v_order_id;
  END IF;

  IF p_final_total < 0 THEN RAISE EXCEPTION 'Total transaksi tidak valid'; END IF;
  IF p_payment_method = 'cash' AND COALESCE(p_amount_paid, 0) < p_final_total THEN
    RAISE EXCEPTION 'Uang pembayaran kurang';
  END IF;

  -- Lock every product row in a stable order before changing stock.
  FOR v_item IN
    SELECT (item->>'product_id')::UUID AS product_id,
           (item->>'quantity')::NUMERIC AS quantity,
           (item->>'unit_price')::INT AS unit_price,
           COALESCE((item->>'discount')::INT, 0) AS discount,
           (item->>'subtotal')::INT AS subtotal
    FROM jsonb_array_elements(p_items) item
    ORDER BY (item->>'product_id')::UUID
  LOOP
    IF v_item.quantity <= 0 THEN RAISE EXCEPTION 'Jumlah item tidak valid'; END IF;
    SELECT quantity INTO v_available
    FROM finished_goods
    WHERE product_id = v_item.product_id AND outlet_id = p_outlet_id
    FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_available, 0) < v_item.quantity THEN
      RAISE EXCEPTION 'Stok produk tidak cukup (produk %, tersedia %, diminta %)', v_item.product_id, COALESCE(v_available, 0), v_item.quantity;
    END IF;
  END LOOP;

  INSERT INTO orders(id, outlet_id, cashier_id, shift_id, service_mode, platform_name, platform_order_id,
    total, discount, final_total, payment_method, amount_paid, change_amount, status, synced, notes)
  VALUES(v_order_id, p_outlet_id, p_cashier_id, p_shift_id, p_service_mode, p_platform_name, p_platform_order_id,
    p_total, COALESCE(p_discount, 0), p_final_total, p_payment_method, p_amount_paid, p_change_amount, 'completed', true, p_notes);

  INSERT INTO order_items(order_id, product_id, quantity, unit_price, discount, subtotal)
  SELECT v_order_id, (item->>'product_id')::UUID, (item->>'quantity')::INT,
    (item->>'unit_price')::INT, COALESCE((item->>'discount')::INT, 0), (item->>'subtotal')::INT
  FROM jsonb_array_elements(p_items) item;

  FOR v_item IN
    SELECT (item->>'product_id')::UUID AS product_id, (item->>'quantity')::NUMERIC AS quantity
    FROM jsonb_array_elements(p_items) item
  LOOP
    UPDATE finished_goods
    SET quantity = quantity - v_item.quantity, updated_at = now()
    WHERE product_id = v_item.product_id AND outlet_id = p_outlet_id;
    INSERT INTO stock_ledger(product_id, type, quantity, reference_type, reference_id, notes, outlet_id, created_by)
    VALUES(v_item.product_id, 'sale', -v_item.quantity, 'order', v_order_id, 'Penjualan kasir', p_outlet_id, p_cashier_id);
  END LOOP;

  IF p_payment_method IN ('cash', 'qris') AND p_final_total > 0 THEN
    INSERT INTO cashflow_entries(outlet_id, shift_id, type, category, amount, description, payment_method, recorded_by)
    VALUES(p_outlet_id, p_shift_id, 'income', CASE WHEN p_payment_method = 'cash' THEN 'sales_cash' ELSE 'sales_qris' END,
      p_final_total, 'Penjualan kasir', p_payment_method, p_cashier_id);
  END IF;

  INSERT INTO audit_logs(outlet_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES(p_outlet_id, p_cashier_id, 'order.completed', 'order', v_order_id,
    jsonb_build_object('total', p_final_total, 'payment_method', p_payment_method, 'service_mode', p_service_mode));

  RETURN v_order_id;
END;
$$;
