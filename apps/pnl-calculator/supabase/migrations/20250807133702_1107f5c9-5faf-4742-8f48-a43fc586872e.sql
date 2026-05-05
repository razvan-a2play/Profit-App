-- Fix the product_id column to use integer instead of UUID
ALTER TABLE public.product_versions 
ALTER COLUMN product_id TYPE integer USING product_id::integer;