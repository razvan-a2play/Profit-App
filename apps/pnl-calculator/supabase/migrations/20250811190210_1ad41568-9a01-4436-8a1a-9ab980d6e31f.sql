-- Fix security: restrict Product Information access to allowlisted authenticated users

-- 1) Drop any existing policies that conflict, then recreate desired policy
DROP POLICY IF EXISTS "Allow public read access to Product Information" ON "Product Information";
DROP POLICY IF EXISTS "Allow allowlisted users to read Product Information" ON "Product Information";

-- Helper function to check allowlist (idempotent via OR REPLACE)
CREATE OR REPLACE FUNCTION public.is_allowlisted_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.allowlist_emails a
    WHERE a.active = true
      AND lower(a.email) = lower(COALESCE((auth.jwt() ->> 'email'), ''))
  );
$$;

-- Create policy to allow only allowlisted authenticated users to read Product Information
CREATE POLICY "Allow allowlisted users to read Product Information"
ON "Product Information"
FOR SELECT
TO authenticated
USING (public.is_allowlisted_user());

-- 2) Ensure emails are normalized in allowlist_emails via trigger (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'normalize_allowlist_email_before_insert'
  ) THEN
    CREATE TRIGGER normalize_allowlist_email_before_insert
    BEFORE INSERT ON public.allowlist_emails
    FOR EACH ROW EXECUTE FUNCTION public.normalize_allowlist_email();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'normalize_allowlist_email_before_update'
  ) THEN
    CREATE TRIGGER normalize_allowlist_email_before_update
    BEFORE UPDATE ON public.allowlist_emails
    FOR EACH ROW EXECUTE FUNCTION public.normalize_allowlist_email();
  END IF;
END $$;