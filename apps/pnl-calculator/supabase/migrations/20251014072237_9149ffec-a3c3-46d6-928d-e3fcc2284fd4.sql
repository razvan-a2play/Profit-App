-- Remove bucket field from all version_data JSON to prevent conflicts
-- The bucket should only be stored in the bucket column, not in version_data
UPDATE product_versions
SET version_data = version_data - 'bucket'
WHERE version_data ? 'bucket';