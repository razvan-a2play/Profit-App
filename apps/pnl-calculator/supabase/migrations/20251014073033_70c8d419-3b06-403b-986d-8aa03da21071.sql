-- Temporarily set all versions to R&D bucket for testing
UPDATE product_versions
SET bucket = 'rd'
WHERE bucket = 'live';