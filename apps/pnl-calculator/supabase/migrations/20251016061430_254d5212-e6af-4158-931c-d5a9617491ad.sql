-- Convert specific versions back to Live bucket
UPDATE product_versions
SET bucket = 'live'
WHERE version_name IN (
  'Tummy time lights up - 30" - ocean',
  'Boat 3 Catamaran',
  'Bath toys - Cargo Train - 3 pcs',
  'Bath toys - Army set - 3 pcs',
  'Bath toys - Cars - 3pcs - FireTruck',
  'Bath toys - Cars - 3pcs - SchoolBus',
  'SEZ0101012 Paws & Bones 69in Pools',
  'SEZ0101011 Sea Life 89in Pool',
  'SEZ0101006 Around the World Pool',
  'SEZ0101002 AtoZ Pool',
  'Cradle Cap Brush Live'
);