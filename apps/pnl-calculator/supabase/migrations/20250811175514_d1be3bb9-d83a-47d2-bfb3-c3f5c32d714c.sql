-- Secure product_versions: add user_id, set triggers, and owner-only RLS

-- 1) Add user_id column and index
ALTER TABLE public.product_versions
ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS idx_product_versions_user_id ON public.product_versions(user_id);
CREATE INDEX IF NOT EXISTS idx_product_versions_user_product ON public.product_versions(user_id, product_id);

-- 2) Trigger to auto-attach current user on insert if not provided
CREATE OR REPLACE FUNCTION public.set_product_versions_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_product_versions_user_id ON public.product_versions;
CREATE TRIGGER trg_set_product_versions_user_id
BEFORE INSERT ON public.product_versions
FOR EACH ROW
EXECUTE FUNCTION public.set_product_versions_user_id();

-- 3) Updated_at trigger (uses existing function in project)
DROP TRIGGER IF EXISTS trg_update_product_versions_updated_at ON public.product_versions;
CREATE TRIGGER trg_update_product_versions_updated_at
BEFORE UPDATE ON public.product_versions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Row Level Security: Drop permissive policy and add owner-only policies
ALTER TABLE public.product_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on product_versions" ON public.product_versions;

-- Only the owner can read their versions
CREATE POLICY "Owners can select their versions" ON public.product_versions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Only the owner can insert versions; user_id auto-filled by trigger if omitted
CREATE POLICY "Owners can insert their versions" ON public.product_versions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Only the owner can update their versions
CREATE POLICY "Owners can update their versions" ON public.product_versions
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Only the owner can delete their versions
CREATE POLICY "Owners can delete their versions" ON public.product_versions
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
