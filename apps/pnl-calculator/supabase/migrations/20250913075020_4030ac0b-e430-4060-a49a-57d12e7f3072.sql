-- Add explicit DENY policies for allowlist_emails table to prevent unauthorized modifications
-- This addresses the security finding about potential unauthorized access to the allowlist

-- Drop any existing policies that might conflict (just in case)
DROP POLICY IF EXISTS "Deny INSERT on allowlist_emails" ON allowlist_emails;
DROP POLICY IF EXISTS "Deny UPDATE on allowlist_emails" ON allowlist_emails;  
DROP POLICY IF EXISTS "Deny DELETE on allowlist_emails" ON allowlist_emails;

-- Create explicit DENY policies for INSERT, UPDATE, DELETE operations
-- These policies will prevent any user from modifying the allowlist
CREATE POLICY "Deny INSERT on allowlist_emails" 
ON allowlist_emails 
FOR INSERT 
TO authenticated 
WITH CHECK (false);

CREATE POLICY "Deny UPDATE on allowlist_emails" 
ON allowlist_emails 
FOR UPDATE 
TO authenticated 
USING (false) 
WITH CHECK (false);

CREATE POLICY "Deny DELETE on allowlist_emails" 
ON allowlist_emails 
FOR DELETE 
TO authenticated 
USING (false);

-- The existing SELECT policy "User can read own allowlist record" remains unchanged
-- This ensures users can still verify their allowlist status but cannot modify it