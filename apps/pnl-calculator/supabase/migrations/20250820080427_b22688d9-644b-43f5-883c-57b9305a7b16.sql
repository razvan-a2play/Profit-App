-- Add bucket column to product_versions table
ALTER TYPE bucket_type AS ENUM ('live', 'rd');

-- Create bucket_type enum if it doesn't exist
DO $$ BEGIN
    CREATE TYPE bucket_type AS ENUM ('live', 'rd');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add bucket column to product_versions table with default value
ALTER TABLE product_versions 
ADD COLUMN bucket bucket_type DEFAULT 'live';