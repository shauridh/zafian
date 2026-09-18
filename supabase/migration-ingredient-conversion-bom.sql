-- SABANA POS: ingredient unit conversion + product BOM
-- Run after schema.sql in Supabase SQL Editor.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS purchase_unit TEXT;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS usage_unit TEXT;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(12,4) DEFAULT 1;

-- Keep existing data usable: old unit is the purchase unit and one purchase unit
-- equals one recipe unit until the operator configures a real conversion.
UPDATE ingredients
SET purchase_unit = COALESCE(purchase_unit, unit),
    usage_unit = COALESCE(usage_unit, unit),
    conversion_factor = COALESCE(NULLIF(conversion_factor, 0), 1)
WHERE purchase_unit IS NULL OR usage_unit IS NULL OR conversion_factor IS NULL OR conversion_factor = 0;

ALTER TABLE ingredients ALTER COLUMN purchase_unit SET DEFAULT 'pack';
ALTER TABLE ingredients ALTER COLUMN usage_unit SET DEFAULT 'pcs';
ALTER TABLE ingredients ALTER COLUMN conversion_factor SET DEFAULT 1;

-- product_ingredients is the menu recipe/BOM: quantity is always in usage_unit.
ALTER TABLE product_ingredients ADD COLUMN IF NOT EXISTS usage_unit TEXT;
ALTER TABLE product_ingredients ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE product_ingredients pi
SET usage_unit = COALESCE(pi.usage_unit, i.usage_unit, i.unit)
FROM ingredients i
WHERE i.id = pi.ingredient_id AND pi.usage_unit IS NULL;

CREATE INDEX IF NOT EXISTS product_ingredients_product_id_idx ON product_ingredients(product_id);
CREATE INDEX IF NOT EXISTS product_ingredients_ingredient_id_idx ON product_ingredients(ingredient_id);

-- Optional convenience view for reporting and HPP checks.
CREATE OR REPLACE VIEW product_bom_costs AS
SELECT
  pi.product_id,
  pi.ingredient_id,
  i.name AS ingredient_name,
  COALESCE(pi.usage_unit, i.usage_unit, i.unit) AS usage_unit,
  pi.quantity,
  ROUND((i.purchase_price::numeric / NULLIF(COALESCE(i.conversion_factor, 1), 0)) * pi.quantity) AS line_cost
FROM product_ingredients pi
JOIN ingredients i ON i.id = pi.ingredient_id;
