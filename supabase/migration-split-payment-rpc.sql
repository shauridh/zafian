-- Run after migration-atomic-payment.sql and migration-phase-remaining.sql.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('cash', 'qris', 'card', 'estimate', 'split'));

CREATE OR REPLACE FUNCTION complete_order_transaction_split(
  p_order_id UUID,
  p_outlet_id UUID,
  p_cashier_id UUID,
  p_shift_id UUID,
  p_service_mode TEXT,
  p_total INT,
  p_discount INT,
  p_final_total INT,
  p_amount_paid INT,
  p_change_amount INT,
  p_items JSONB,
  p_split_payments JSONB,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_order_id UUID;
  v_split_total INT;
  v_payment RECORD;
BEGIN
  SELECT COALESCE(SUM((item->>'amount')::INT), 0) INTO v_split_total
  FROM jsonb_array_elements(p_split_payments) item;
  IF v_split_total <> p_final_total THEN
    RAISE EXCEPTION 'Total split payment (%) harus sama dengan total transaksi (%)', v_split_total, p_final_total;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_split_payments) item WHERE (item->>'amount')::INT <= 0) THEN
    RAISE EXCEPTION 'Nominal split payment harus lebih besar dari 0';
  END IF;

  v_order_id := complete_order_transaction(
    p_order_id, p_outlet_id, p_cashier_id, p_shift_id, p_service_mode,
    NULL, NULL, p_total, p_discount, p_final_total, 'split',
    p_amount_paid, p_change_amount, p_items, p_notes
  );

  FOR v_payment IN SELECT (item->>'method')::TEXT AS method, (item->>'amount')::INT AS amount, item->>'reference' AS reference FROM jsonb_array_elements(p_split_payments) item LOOP
    INSERT INTO split_payments(order_id, method, amount, reference) VALUES(v_order_id, v_payment.method, v_payment.amount, v_payment.reference);
    IF v_payment.method IN ('cash', 'qris') THEN
      INSERT INTO cashflow_entries(outlet_id, shift_id, type, category, amount, description, payment_method, recorded_by)
      VALUES(p_outlet_id, p_shift_id, 'income', CASE WHEN v_payment.method = 'cash' THEN 'sales_cash' ELSE 'sales_qris' END, v_payment.amount, 'Split payment kasir', v_payment.method, p_cashier_id);
    END IF;
  END LOOP;
  RETURN v_order_id;
END;
$$;
