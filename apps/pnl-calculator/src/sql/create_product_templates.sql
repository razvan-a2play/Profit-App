-- Create the product_templates table for storing SKU data
CREATE TABLE IF NOT EXISTS product_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  factory_price_inputs DECIMAL(10,2) DEFAULT 0,
  length DECIMAL(10,2) DEFAULT 0,
  width DECIMAL(10,2) DEFAULT 0,
  height DECIMAL(10,2) DEFAULT 0,
  weight DECIMAL(10,2) DEFAULT 0,
  master_carton_length DECIMAL(10,2) DEFAULT 0,
  master_carton_width DECIMAL(10,2) DEFAULT 0,
  master_carton_height DECIMAL(10,2) DEFAULT 0,
  master_carton_units INTEGER DEFAULT 0,
  master_carton_weight DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE product_templates ENABLE ROW LEVEL SECURITY;

-- Restrictive policy: allow only allowlisted users to read
DROP POLICY IF EXISTS "Allow all operations on product_templates" ON product_templates;
CREATE POLICY "Allow allowlisted users to read product_templates" ON product_templates FOR SELECT USING (is_allowlisted_user());

-- Insert some sample data
INSERT INTO product_templates (sku, name, factory_price_inputs, length, width, height, weight, master_carton_length, master_carton_width, master_carton_height, master_carton_units, master_carton_weight) VALUES
('SKU001', 'Sample Product 1', 15.50, 10.0, 8.0, 5.0, 0.5, 40.0, 38.0, 32.0, 24, 19.0),
('SKU002', 'Sample Product 2', 22.75, 12.0, 10.0, 6.0, 0.8, 50.0, 40.0, 36.0, 20, 25.0),
('SKU003', 'Sample Product 3', 8.99, 8.0, 6.0, 4.0, 0.3, 35.0, 30.0, 28.0, 30, 15.0)
ON CONFLICT (sku) DO NOTHING;