-- Clear hidden cost field values from R&D versions
-- This removes the actual cost data for fields marked as hidden

UPDATE product_versions
SET version_data = jsonb_set(
  jsonb_set(
    version_data,
    '{cost}',
    'null'::jsonb
  ),
  '{costQuantity}',
  'null'::jsonb
)
WHERE bucket = 'rd'
  AND (version_data->>'productCostVisible')::boolean = false;

UPDATE product_versions
SET version_data = jsonb_set(
  jsonb_set(
    version_data,
    '{retailBoxCost}',
    'null'::jsonb
  ),
  '{retailBoxCostQuantity}',
  'null'::jsonb
)
WHERE bucket = 'rd'
  AND (version_data->>'retailBoxCostVisible')::boolean = false;

UPDATE product_versions
SET version_data = jsonb_set(
  jsonb_set(
    version_data,
    '{cardCost}',
    'null'::jsonb
  ),
  '{cardCostQuantity}',
  'null'::jsonb
)
WHERE bucket = 'rd'
  AND (version_data->>'cardCostVisible')::boolean = false;

UPDATE product_versions
SET version_data = jsonb_set(
  jsonb_set(
    version_data,
    '{userManualCost}',
    'null'::jsonb
  ),
  '{userManualCostQuantity}',
  'null'::jsonb
)
WHERE bucket = 'rd'
  AND (version_data->>'userManualCostVisible')::boolean = false;