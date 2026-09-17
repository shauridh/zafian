-- ============================================
-- MIGRATION: Add missing columns to orders table
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Add missing columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_source TEXT DEFAULT 'pos';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_number INT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS hpp_total INT DEFAULT 0;

-- 2. Add missing columns to customers table (for portal)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  phone TEXT UNIQUE,
  email TEXT,
  address TEXT,
  city TEXT,
  points INT DEFAULT 0,
  stamps INT DEFAULT 0,
  tier TEXT DEFAULT 'bronze',
  otp_code TEXT,
  otp_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on customers
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on customers" ON customers FOR ALL USING (true) WITH CHECK (true);

-- 3. Fix orders order_number to be TEXT (not SERIAL) for flexibility
-- We'll add a text order_number column and keep the serial as internal
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number_text TEXT;

-- 4. Add loyalty_customers columns for portal
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS otp_code TEXT;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS otp_expires TIMESTAMPTZ;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'bronze';
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS city TEXT;

-- 5. Seed default users if table is empty
INSERT INTO users (id, name, role, outlet_id, pin)
SELECT '30000000-0000-0000-0000-000000000001', 'Ahmad', 'cashier', '00000000-0000-0000-0000-000000000001', '1234'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = '30000000-0000-0000-0000-000000000001');

INSERT INTO users (id, name, role, outlet_id, pin)
SELECT '30000000-0000-0000-0000-000000000002', 'Rina', 'cashier', '00000000-0000-0000-0000-000000000001', '1234'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = '30000000-0000-0000-0000-000000000002');

INSERT INTO users (id, name, role, outlet_id, pin)
SELECT '30000000-0000-0000-0000-000000000003', 'Budi', 'admin', '00000000-0000-0000-0000-000000000001', '1234'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = '30000000-0000-0000-0000-000000000003');

INSERT INTO users (id, name, role, outlet_id, pin)
SELECT '30000000-0000-0000-0000-000000000004', 'Sari', 'manager', '00000000-0000-0000-0000-000000000001', '1234'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = '30000000-0000-0000-0000-000000000004');

-- 6. Verify
SELECT 'Migration complete! Tables:' as info;
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
