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

describe("selling-price bands from a published rate card", () => {
  const override = {
    regular: [
      {
        tier: "large standard",
        weightRange: "4+ to 8 oz",
        nonPeak: 3.95,
        peak: 3.95,
        weightBasis: "Greater of unit or dimensional weight",
        lowPrice: 3.13,
        highPrice: 4.21,
      },
    ],
    hazmat: [],
  };
  // SPBATH0034's real box: 13.7 x 9.2 x 5.1 cm, 100 g -> large standard, 4-8 oz.
  const dims = [13.7, 9.2, 5.1, 0.1] as const;

  it("charges an $11 item the $10-$50 rate", () => {
    const r = calculateFBATierAndFee(...dims, 11.0, false, override);
    expect(r.feeNonPeak).toBe(3.95);
  });

  it("charges a $6.42 item the Low-Price rate", () => {
    const r = calculateFBATierAndFee(...dims, 6.42, false, override);
    expect(r.feeNonPeak).toBe(3.13);
  });

  it("charges a $60 item the >$50 rate", () => {
    const r = calculateFBATierAndFee(...dims, 60, false, override);
    expect(r.feeNonPeak).toBe(4.21);
  });

  it("falls back to the mid rate when the card has no band columns", () => {
    const noBands = {
      regular: [{ ...override.regular[0], lowPrice: undefined, highPrice: undefined }],
      hazmat: [],
    };
    expect(calculateFBATierAndFee(...dims, 6.42, false, noBands).feeNonPeak).toBe(3.95);
  });
});

describe("a surcharge interval that is not a pound", () => {
  // Large standard's top band is published per 4 oz:
  //   "3+ lb to 20 lb | $6.97 + $0.08 per 4 oz interval above first 3 lb"
  // Treating that as a per-POUND surcharge charges a quarter of the real fee.
  const override = {
    regular: [
      {
        tier: "large standard",
        weightRange: "3+ to 20 lb",
        nonPeak: 6.97,
        peak: 7.51,
        weightBasis: "Greater of unit or dimensional weight",
        surchargePerInterval: 0.08,
        surchargeIntervalLb: 0.25,
        surchargeAboveLb: 3,
      },
    ],
    hazmat: [],
  };
  // ~40 x 30 x 12 cm, 2.5 kg -> large standard, ~5.5 lb billable.
  const box = [40, 30, 12, 2.5] as const;

  it("charges one surcharge per 4 oz interval, not per pound", () => {
    const r = calculateFBATierAndFee(...box, 25, false, override);
    expect(r.tier.toLowerCase()).toBe("large standard");
    const intervals = Math.ceil((r.billableWeight - 3) / 0.25);
    expect(r.feeNonPeak).toBeCloseTo(6.97 + intervals * 0.08, 2);
    // and it is materially more than a per-pound reading would have charged
    const perPound = 6.97 + Math.ceil(r.billableWeight - 3) * 0.08;
    expect(r.feeNonPeak).toBeGreaterThan(perPound + 0.5);
  });

  it("matches an open-ended top band on its lower bound alone", () => {
    const heavy = {
      regular: [
        {
          tier: "extra-large",
          weightRange: "150+ lb",
          nonPeak: 194.95,
          peak: 203.46,
          weightBasis: "Greater of unit or dimensional weight",
          surchargePerInterval: 0.19,
          surchargeIntervalLb: 1,
          surchargeAboveLb: 151,
        },
      ],
      hazmat: [],
    };
    // ~120 x 40 x 30 cm, 80 kg -> extra-large, 176 lb on unit weight.
    const r = calculateFBATierAndFee(120, 40, 30, 80, 400, false, heavy);
    expect(r.tier.toLowerCase()).toBe("extra-large");
    expect(r.feeNonPeak).toBeCloseTo(194.95 + Math.ceil(r.billableWeight - 151) * 0.19, 2);
  });
});

describe("bulky / extra-large formulas from a published rate card", () => {
  // "Large bulky | 0 to 50 lb | $8.58 + $0.38/lb interval above first lb"
  const override = {
    regular: [
      {
        tier: "large bulky",
        weightRange: "0+ to 50 lb",
        nonPeak: 8.58,
        peak: 9.35,
        weightBasis: "Greater of unit or dimensional weight",
        surchargePerInterval: 0.38,
        surchargeIntervalLb: 1,
        surchargeAboveLb: 1,
      },
      {
        tier: "extra-large",
        weightRange: "50+ to 70 lb",
        nonPeak: 36.55,
        peak: 37.32,
        weightBasis: "Greater of unit or dimensional weight",
        surchargePerInterval: 0.75,
        surchargeIntervalLb: 1,
        surchargeAboveLb: 51,
      },
    ],
    hazmat: [],
  };
  // ~62 x 36 x 36 cm, 5 kg -> large bulky, ~11 lb.
  const bulky = [62, 36, 36, 5] as const;

  it("adds the published per-pound surcharge to the published base", () => {
    const r = calculateFBATierAndFee(...bulky, 40, false, override);
    expect(r.tier.toLowerCase()).toBe("large bulky");
    const intervals = Math.ceil(r.billableWeight - 1);
    expect(r.feeNonPeak).toBeCloseTo(8.58 + intervals * 0.38, 2);
  });

  it("charges a part pound as a whole interval, as Amazon states", () => {
    // 1.2 lb over the threshold is 2 intervals, not 1.2.
    const rows = [{ ...override.regular[0], nonPeak: 10, peak: 10 }];
    const r = calculateFBATierAndFee(62, 36, 36, 1.0, 40, false, {
      regular: rows,
      hazmat: [],
    });
    const over = Math.max(0, r.billableWeight - 1);
    expect(r.feeNonPeak).toBeCloseTo(10 + Math.ceil(over) * 0.38, 2);
  });

  it("uses the published formula instead of the hardcoded fallback", () => {
    // The built-in branch for large bulky uses a $6.75 base; the card says
    // $8.58. Drifting silently back to $6.75 is the bug this prevents.
    const withCard = calculateFBATierAndFee(...bulky, 40, false, override);
    const withoutCard = calculateFBATierAndFee(...bulky, 40, false);
    expect(withCard.feeNonPeak).not.toBeCloseTo(withoutCard.feeNonPeak, 2);
    expect(withCard.feeNonPeak).toBeGreaterThan(withoutCard.feeNonPeak);
  });

  it("still falls back to the built-in branch when the card lacks the tier", () => {
    const onlyStandard = {
      regular: [
        {
          tier: "large standard",
          weightRange: "4+ to 8 oz",
          nonPeak: 3.95,
          peak: 3.95,
          weightBasis: "Greater of unit or dimensional weight",
        },
      ],
      hazmat: [],
    };
    const r = calculateFBATierAndFee(...bulky, 40, false, onlyStandard);
    const plain = calculateFBATierAndFee(...bulky, 40, false);
    expect(r.feeNonPeak).toBeCloseTo(plain.feeNonPeak, 2);
  });
});
