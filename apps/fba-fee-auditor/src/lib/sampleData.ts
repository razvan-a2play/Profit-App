// Realistic demo data so the dashboard renders end-to-end before the live
// Seller-Central and Product Library connections are wired in. Mirrors the
// classic FBA overcharge pattern: Amazon mis-measures a couple of SKUs into a
// bigger size tier than the real box warrants.

import type { AmazonMeasuredRow, RealMeasurement } from "@platform/calc";

export const SAMPLE_AMAZON_ROWS: AmazonMeasuredRow[] = [
  {
    sku: "MUG-WHITE-11OZ",
    asin: "B00MUG0011",
    productName: "Ceramic Coffee Mug 11oz, White",
    yourPrice: 14.99,
    longestSide: 9.1, // measured fat — should be ~5in
    medianSide: 6.0,
    shortestSide: 5.2,
    unitOfDimension: "inches",
    itemPackageWeight: 1.85,
    unitOfWeight: "pounds",
    productSizeTier: "Large standard-size",
    expectedFulfillmentFee: 5.0,
    currency: "USD",
  },
  {
    sku: "CABLE-USBC-2M",
    asin: "B00CBL2M00",
    productName: "USB-C Cable 2m Braided",
    yourPrice: 9.99,
    longestSide: 7.0, // measured bulky — real is a flat pouch
    medianSide: 6.4,
    shortestSide: 2.3,
    unitOfDimension: "inches",
    itemPackageWeight: 0.55,
    unitOfWeight: "pounds",
    productSizeTier: "Large standard-size",
    expectedFulfillmentFee: 4.43,
    currency: "USD",
  },
  {
    sku: "NOTE-A5-DOT",
    asin: "B00NOTEA50",
    productName: "A5 Dotted Notebook",
    yourPrice: 12.5,
    longestSide: 8.4,
    medianSide: 5.9,
    shortestSide: 0.7,
    unitOfDimension: "inches",
    itemPackageWeight: 0.62,
    unitOfWeight: "pounds",
    productSizeTier: "Large standard-size",
    expectedFulfillmentFee: 3.78,
    currency: "USD",
  },
  {
    // Sold on FBA but has no real box measurement → "needs measurement".
    sku: "GIFTSET-XL-001",
    asin: "B00GIFT0001",
    productName: "Deluxe Gift Set (Large Box)",
    yourPrice: 39.99,
    longestSide: 14.2,
    medianSide: 11.8,
    shortestSide: 6.4,
    unitOfDimension: "inches",
    itemPackageWeight: 3.7,
    unitOfWeight: "pounds",
    productSizeTier: "Large bulky",
    expectedFulfillmentFee: 9.61,
    currency: "USD",
  },
];

export const SAMPLE_REAL_MEASUREMENTS: RealMeasurement[] = [
  // Real mug box is compact → Small standard, but Amazon charged Large standard.
  { sku: "MUG-WHITE-11OZ", lengthCm: 12.5, widthCm: 10.5, heightCm: 10.5, weightKg: 0.42, unitsSold: 320 },
  // Real cable pouch is thin → Small standard, Amazon charged Large standard.
  { sku: "CABLE-USBC-2M", lengthCm: 16, widthCm: 12, heightCm: 2, weightKg: 0.12, unitsSold: 1100 },
  // Notebook genuinely is large standard → should come back OK (no overcharge).
  { sku: "NOTE-A5-DOT", lengthCm: 21, widthCm: 14.8, heightCm: 1.5, weightKg: 0.28, unitsSold: 210 },
];
