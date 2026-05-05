import { describe, expect, it } from "vitest";
import {
  calculateFBATierAndFee,
  calculateReferralFee,
  calculateReturnProcessingFee,
  calculateSippDiscount,
  checkSippEligibility,
} from "./fbaFees";

describe("calculateFBATierAndFee", () => {
  it("returns Unknown / 0 for missing dimensions", () => {
    expect(calculateFBATierAndFee(0, 10, 5, 0.2, 9.99).tier).toBe("Unknown");
    expect(calculateFBATierAndFee(10, 0, 5, 0.2, 9.99).feeNonPeak).toBe(0);
  });

  it("classifies a tiny item as small standard with the table fee", () => {
    // 5cm x 5cm x 1cm, 50g  (~1.76 oz) → small standard, 2 oz or less = $2.43
    const r = calculateFBATierAndFee(5, 5, 1, 0.05, 9.99);
    expect(r.tier).toBe("Small standard");
    expect(r.feeNonPeak).toBe(2.43);
    expect(r.feePeak).toBe(3.25);
  });

  it("uses the hazmat rate table when hazmat=true", () => {
    const reg = calculateFBATierAndFee(5, 5, 1, 0.05, 9.99, false);
    const haz = calculateFBATierAndFee(5, 5, 1, 0.05, 9.99, true);
    expect(haz.feeNonPeak).toBeGreaterThan(reg.feeNonPeak);
    expect(haz.tier).toBe(reg.tier);
  });

  it("uses dynamic 4-oz interval pricing for large standard above 3 lb", () => {
    // 30cm x 20cm x 5cm, 1.6kg → 1.6 / 0.453592 ≈ 3.527 lb (large standard)
    // extra = 0.527 lb; intervals = ceil(0.527 * 16 / 4) = ceil(2.108) = 3
    // base 6.15 + 3 * 0.08 = 6.39
    const r = calculateFBATierAndFee(30, 20, 5, 1.6, 19.99);
    expect(r.tier).toBe("Large standard");
    expect(r.feeNonPeak).toBeCloseTo(6.39, 2);
  });
});

describe("calculateReferralFee", () => {
  it("returns invalid-input error on bad inputs", () => {
    expect(calculateReferralFee("", 10).error).toBe("❌ Invalid input");
    expect(calculateReferralFee("books", NaN).error).toBe("❌ Invalid input");
  });

  it("returns category-not-found for unknown categories", () => {
    expect(calculateReferralFee("nonexistent", 10).error).toBe("❌ Category not found");
  });

  it("applies a flat-rate category and enforces the $0.30 minimum", () => {
    // books: 15% of $1 = $0.15 → floored to $0.30
    expect(calculateReferralFee("books", 1).fee).toBe(0.30);
    expect(calculateReferralFee("books", 100).fee).toBe(15);
    expect(calculateReferralFee("books", 100).rate).toBe(15);
  });

  it("uses the lower bracket for prices at or below the threshold", () => {
    // beauty <= $10: 8%; > $10: 15%
    expect(calculateReferralFee("beauty", 10).rate).toBe(8);
    expect(calculateReferralFee("beauty", 10.01).rate).toBe(15);
  });

  it("uses the upper bracket above the threshold (jewelry)", () => {
    // jewelry: <=$250 → 20%; >$250 → 5%
    expect(calculateReferralFee("jewelry", 250).rate).toBe(20);
    expect(calculateReferralFee("jewelry", 251).rate).toBe(5);
  });
});

describe("checkSippEligibility", () => {
  it("requires longest > 6, median > 4, shortest > 0.375 inches", () => {
    // 20x12x2 cm = 7.87 x 4.72 x 0.79 in → all pass
    expect(checkSippEligibility(20, 12, 2)).toBe("YES");
    // 14x10x0.5 cm = 5.51 x 3.94 x 0.20 in → all fail
    expect(checkSippEligibility(14, 10, 0.5)).toBe("NO");
  });

  it("ignores the order of inputs (it sorts internally)", () => {
    // Same physical product, dims passed in different order.
    expect(checkSippEligibility(2, 20, 12)).toBe("YES");
  });
});

describe("calculateSippDiscount", () => {
  it("returns 0 for an unrecognized tier", () => {
    expect(calculateSippDiscount("flying squirrel", 5)).toBe(0);
  });

  it("matches small-standard oz brackets", () => {
    expect(calculateSippDiscount("small standard", 1)).toBe(0.04);   // ≤ 2 oz
    expect(calculateSippDiscount("small standard", 5)).toBe(0.05);   // 4+ to 6
    expect(calculateSippDiscount("small standard", 16)).toBe(0.07);  // 14+ to 16
  });

  it("matches large-standard lb brackets", () => {
    // 1.5 lb = 24 oz → 1+ to 1.25 lb? No — 24oz/16 = 1.5 → 1.25+ to 1.5 → 0.09
    expect(calculateSippDiscount("large standard", 24)).toBe(0.09);
    // 3.5 lb = 56 oz → 3+ lb to 20 lb (range with "to") → 0.23
    expect(calculateSippDiscount("large standard", 56)).toBe(0.23);
  });
});

describe("calculateReturnProcessingFee", () => {
  it("returns 0 for unknown tier or NaN weight", () => {
    expect(calculateReturnProcessingFee("unknown", 10)).toBe(0);
    expect(calculateReturnProcessingFee("small standard", NaN)).toBe(0);
  });

  it("uses oz brackets for small/large standard", () => {
    expect(calculateReturnProcessingFee("small standard", 1)).toBe(1.78);   // ≤ 2 oz
    expect(calculateReturnProcessingFee("small standard", 16)).toBe(2.21);  // last oz bracket
    expect(calculateReturnProcessingFee("large standard", 4)).toBe(2.36);
  });

  it("falls back to the 4-oz interval formula for large standard above 48 oz", () => {
    // 60 oz → extraOz = 12 → intervals = 3 → 5.00 + 0.05*3 = 5.15
    expect(calculateReturnProcessingFee("large standard", 60)).toBe(5.15);
  });

  it("uses the lb formula for large bulky", () => {
    // 6.74 + 0.32 * max(0, 5 - 1) = 6.74 + 1.28 = 8.02
    expect(calculateReturnProcessingFee("large bulky", 5 * 16)).toBe(8.02);
  });
});
