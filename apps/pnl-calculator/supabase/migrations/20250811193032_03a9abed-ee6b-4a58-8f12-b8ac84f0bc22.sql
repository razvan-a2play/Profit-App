-- Security hardening migration

-- 1) Allowlist: enforce uniqueness and normalize emails
CREATE UNIQUE INDEX IF NOT EXISTS allowlist_emails_email_lower_unique
  ON public.allowlist_emails ((lower(email)));

DROP TRIGGER IF EXISTS normalize_allowlist_email_before_insupd ON public.allowlist_emails;
CREATE TRIGGER normalize_allowlist_email_before_insupd
BEFORE INSERT OR UPDATE ON public.allowlist_emails
FOR EACH ROW
EXECUTE FUNCTION public.normalize_allowlist_email();

-- 2) Product versions: ensure user ownership and maintain timestamps
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_product_versions_user_id_before_insert'
  ) THEN
    CREATE TRIGGER set_product_versions_user_id_before_insert
    BEFORE INSERT ON public.product_versions
    FOR EACH ROW
    EXECUTE FUNCTION public.set_product_versions_user_id();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_product_versions_updated_at'
  ) THEN
    CREATE TRIGGER update_product_versions_updated_at
    BEFORE UPDATE ON public.product_versions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Conditionally enforce NOT NULL on user_id (won't break if legacy NULLs exist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.product_versions WHERE user_id IS NULL) THEN
    ALTER TABLE public.product_versions ALTER COLUMN user_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'Found product_versions.user_id NULLs; skipping NOT NULL enforcement.';
  END IF;
END $$;

-- 3) Secure product_templates creation + RLS
CREATE TABLE IF NOT EXISTS public.product_templates (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_templates ENABLE ROW LEVEL SECURITY;

-- Drop any overly permissive policy if present
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'product_templates' AND policyname = 'Allow all operations on product_templates'
  ) THEN
    DROP POLICY "Allow all operations on product_templates" ON public.product_templates;
  END IF;
END $$;

-- Read-only access for allowlisted users
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'product_templates' AND policyname = 'Allow allowlisted users to read product templates'
  ) THEN
    CREATE POLICY "Allow allowlisted users to read product templates"
    ON public.product_templates
    FOR SELECT
    USING (public.is_allowlisted_user());
  END IF;
END $$;

-- Maintain updated_at on updates
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_product_templates_updated_at'
  ) THEN
    CREATE TRIGGER update_product_templates_updated_at
    BEFORE UPDATE ON public.product_templates
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Seed sample data idempotently (runs as admin, bypasses RLS)
INSERT INTO public.product_templates (
  sku, name, factory_price_inputs, length, width, height, weight,
  master_carton_length, master_carton_width, master_carton_height, master_carton_units, master_carton_weight
) VALUES
  ('SKU001', 'Sample Product 1', 15.50, 10.0, 8.0, 5.0, 0.5, 40.0, 38.0, 32.0, 24, 19.0),
  ('SKU002', 'Sample Product 2', 22.75, 12.0, 10.0, 6.0, 0.8, 50.0, 40.0, 36.0, 20, 25.0),
  ('SKU003', 'Sample Product 3', 8.99, 8.0, 6.0, 4.0, 0.3, 35.0, 30.0, 28.0, 30, 15.0)
ON CONFLICT (sku) DO NOTHING;