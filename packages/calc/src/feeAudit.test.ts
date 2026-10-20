import { describe, expect, it } from "vitest";
import {
  auditSku,
  auditCatalog,
  tierRank,
  type AmazonMeasuredRow,
  type RealMeasurement,
} from "./feeAudit";

// A tiny product: 5cm x 5cm x 1cm, 50g → "Small standard", $2.43 (see fbaFees.test).
const realTiny: RealMeasurement = {
  sku: "TINY-1",
  lengthCm: 5,
  widthCm: 5,
  heightCm: 1,
  weightKg: 0.05,
  unitsSold: 100,
};

// Amazon mis-measured it into Large standard and charges $4.00.
const amazonInflated: AmazonMeasuredRow = {
  sku: "TINY-1",
  asin: "B000TINY",
  productName: "Tiny Widget",
  yourPrice: 12.99,
  longestSide: 10,
  medianSide: 8,
  shortestSide: 2,
  unitOfDimension: "inches",
  itemPackageWeight: 0.5,
  unitOfWeight: "pounds",
  productSizeTier: "Large standard-size",
  expectedFulfillmentFee: 4.0,
  currency: "USD",
};

describe("tierRank", () => {
  it("ranks Amazon and calc tier spellings on one scale", () => {
    expect(tierRank("Small standard-size")).toBe(0);
    expect(tierRank("Small standard")).toBe(0);
    expect(tierRank("Large standard-size")).toBe(1);
    expect(tierRank("Small bulky")).toBe(2);
    expect(tierRank("Large bulky")).toBe(3);
    expect(tierRank("Extra-large 0 to 50 lb")).toBe(4);
    expect(tierRank(undefined)).toBe(-1);
    expect(tierRank("nonsense")).toBe(-1);
  });

  it("orders small standard below large standard", () => {
    expect(tierRank("Small standard")).toBeLessThan(tierRank("Large standard-size"));
  });
});

describe("auditSku", () => {
  it("flags a clear tier-inflation overcharge with high confidence", () => {
    const f = auditSku(amazonInflated, realTiny);
    expect(f.status).toBe("overcharge");
    expect(f.confidence).toBe("high");
    expect(f.correctTier).toBe("Small standard");
    expect(f.amazonTier).toBe("Large standard-size");
    expect(f.tierInflated).toBe(true);
    // Correct fee = base $2.43 × 1.035 fuel surcharge = $2.52.
    expect(f.correctFee).toBeCloseTo(2.52, 2);
    expect(f.amazonFee).toBe(4.0);
    expect(f.feeDeltaPerUnit).toBeCloseTo(1.48, 1);
    expect(f.recoverablePerUnit).toBeCloseTo(1.48, 1);
    expect(f.recoverableTotal).toBeCloseTo(148.5, 0);
  });

  it("nets to ~zero when Amazon charges base + fuel surcharge on matching dims", () => {
    // Real tiny box → base $2.43; Amazon (matching dims) charges 2.43×1.035=$2.52.
    const surcharged: AmazonMeasuredRow = {
      sku: "TINY-1",
      longestSide: 1.97,
      medianSide: 1.97,
      shortestSide: 0.39,
      itemPackageWeight: 0.11,
      productSizeTier: "Small standard-size",
      expectedFulfillmentFee: 2.52,
    };
    const f = auditSku(surcharged, realTiny);
    expect(f.status).toBe("ok");
    expect(Math.abs(f.feeDeltaPerUnit)).toBeLessThan(0.02);
    expect(f.recoverablePerUnit).toBe(0);
  });

  // realTiny → small-standard 2oz: regular base $2.43 (×1.035=$2.52), hazmat base
  // $3.40 (×1.035=$3.52). Amazon charging $3.52 = the hazmat rate.
  const chargedHazmatRate: AmazonMeasuredRow = {
    sku: "TINY-1",
    longestSide: 1.97,
    medianSide: 1.97,
    shortestSide: 0.39,
    itemPackageWeight: 0.11,
    productSizeTier: "Small standard-size",
    expectedFulfillmentFee: 3.52,
  };

  it("flags a hazmat mis-charge when the option is enabled and the product isn't hazmat", () => {
    const f = auditSku(chargedHazmatRate, { ...realTiny, hazmat: false }, { detectHazmatMischarge: true });
    expect(f.status).toBe("overcharge");
    expect(f.confidence).toBe("high");
    expect(f.recoverablePerUnit).toBeCloseTo(1.0, 1); // ~$3.52 − $2.52 hazmat premium
    expect(f.notes.some((n) => /hazmat|Dangerous Goods/i.test(n))).toBe(true);
  });

  it("does NOT flag hazmat mis-charge when detection is off (avoids false positives)", () => {
    const f = auditSku(chargedHazmatRate, { ...realTiny, hazmat: false });
    expect(f.status).toBe("ok"); // fee gap with matching dims → rate-table note, not a dispute
    expect(f.recoverablePerUnit).toBe(0);
  });

  it("does not flag a genuinely-hazmat product charged the hazmat rate", () => {
    const f = auditSku(chargedHazmatRate, { ...realTiny, hazmat: true }, { detectHazmatMischarge: true });
    expect(f.status).toBe("ok");
    expect(f.recoverablePerUnit).toBe(0);
  });

  it("returns ok when Amazon's fee matches the real-dims fee", () => {
    const fair: AmazonMeasuredRow = {
      sku: "TINY-1",
      longestSide: 2,
      medianSide: 2,
      shortestSide: 0.5,
      itemPackageWeight: 0.12,
      productSizeTier: "Small standard-size",
      expectedFulfillmentFee: 2.43,
    };
    const f = auditSku(fair, realTiny);
    expect(f.status).toBe("ok");
    expect(f.tierInflated).toBe(false);
    expect(f.recoverablePerUnit).toBe(0);
  });

  it("treats a lower-than-expected fee as ok, never recoverable", () => {
    const cheap: AmazonMeasuredRow = {
      sku: "TINY-1",
      productSizeTier: "Small standard-size",
      expectedFulfillmentFee: 1.0,
    };
    const f = auditSku(cheap, realTiny);
    expect(f.status).toBe("ok");
    expect(f.recoverablePerUnit).toBe(0);
  });

  it("reports missing_measurement when the Library has no dims", () => {
    const f = auditSku(amazonInflated, undefined);
    expect(f.status).toBe("missing_measurement");
    expect(f.recoverablePerUnit).toBe(0);
  });

  it("reports missing_amazon when the report lacks the SKU", () => {
    const f = auditSku(undefined, realTiny);
    expect(f.status).toBe("missing_amazon");
    expect(f.sku).toBe("TINY-1");
  });

  it("does NOT flag an overcharge on a fee gap alone (rate-table noise)", () => {
    // Same tier, dims/weight match — a fee gap with no physical evidence is
    // rate-table drift, not a mis-measurement. Must not be flagged as recoverable.
    // Measured dims match realTiny (5×5×1cm ≈ 1.97×1.97×0.39in, 0.11lb); only
    // the fee differs — exactly the SPBATH0027 false-positive scenario.
    const feeOnly: AmazonMeasuredRow = {
      sku: "TINY-1",
      longestSide: 1.97,
      medianSide: 1.97,
      shortestSide: 0.39,
      itemPackageWeight: 0.11,
      productSizeTier: "Small standard-size",
      expectedFulfillmentFee: 3.5,
    };
    const f = auditSku(feeOnly, realTiny);
    expect(f.status).toBe("ok");
    expect(f.confidence).toBe("low");
    expect(f.recoverablePerUnit).toBe(0);
    expect(f.notes.some((n) => /rate-table/i.test(n))).toBe(true);
  });
});

describe("auditCatalog", () => {
  it("joins by SKU case-insensitively, ranks overcharges first, and sums recoverable", () => {
    const amazon: AmazonMeasuredRow[] = [
      amazonInflated,
      { sku: "fair-2", productSizeTier: "Small standard-size", expectedFulfillmentFee: 2.43 },
    ];
    const real: RealMeasurement[] = [
      { ...realTiny, sku: "tiny-1" }, // lowercase — must still join
      { sku: "FAIR-2", lengthCm: 5, widthCm: 5, heightCm: 1, weightKg: 0.05, unitsSold: 10 },
    ];
    const { findings, summary } = auditCatalog(amazon, real);

    expect(summary.totalSkus).toBe(2);
    expect(summary.overcharges).toBe(1);
    expect(summary.recoverableTotal).toBeCloseTo(148.5, 0);
    // Overcharge ranked first.
    expect(findings[0].sku).toBe("TINY-1");
    expect(findings[0].status).toBe("overcharge");
  });
});

describe("hazmat mis-charge, weight-band boundary false positive", () => {
  // BDRL002: our box weighs 2.72 lb, Amazon measured 2.81 lb. That 0.09 lb is
  // inside the weight tolerance, but it crosses the 2.75 lb band boundary, so
  // Amazon's correct fee ($6.90) lands within pennies of the hazmat rate for
  // the band BELOW ($6.96) — and was reported as a Dangerous Goods mis-charge.
  const card = {
    regular: [
      { tier: "large standard", weightRange: "2.5+ to 2.75 lb", nonPeak: 6.26, peak: 6.26,
        weightBasis: "Greater of unit or dimensional weight" },
      { tier: "large standard", weightRange: "2.75+ to 3 lb", nonPeak: 6.67, peak: 6.67,
        weightBasis: "Greater of unit or dimensional weight" },
    ],
    hazmat: [
      { tier: "large standard", weightRange: "2.5+ to 2.75 lb", nonPeak: 6.72, peak: 6.72,
        weightBasis: "Greater of unit or dimensional weight" },
      { tier: "large standard", weightRange: "2.75+ to 3 lb", nonPeak: 7.13, peak: 7.13,
        weightBasis: "Greater of unit or dimensional weight" },
    ],
  };
  const opts = { detectHazmatMischarge: true, feeTable: card };
  // Flat-ish box so unit weight, not dimensional weight, sets the band.
  const amazon = {
    sku: "BDRL002",
    yourPrice: 23.99,
    longestSide: 9.9, medianSide: 7.1, shortestSide: 2.8,
    itemPackageWeight: 2.81, // one band above our 2.72 lb
    productSizeTier: "UsLargeStandardSize",
    expectedFulfillmentFee: 6.9, // = 6.67 x 1.035, the correct rate for 2.81 lb
  };
  const real = {
    sku: "BDRL002", lengthCm: 25, widthCm: 18, heightCm: 7,
    weightKg: 1.234, hazmat: false, // 2.72 lb
  };

  it("does not call it a hazmat mis-charge when Amazon billed its own box correctly", () => {
    const f = auditSku(amazon, real, opts);
    expect(f.notes.some((n) => /Dangerous Goods/i.test(n))).toBe(false);
  });

  it("flags it as a measurement variance, not as noise", () => {
    const f = auditSku(amazon, real, opts);
    expect(f.status).toBe("measurement_variance");
    // The money is real and must be carried, not zeroed out as "ok".
    expect(f.recoverablePerUnit).toBeCloseTo(0.42, 2);
    expect(f.notes.some((n) => /higher fee band/i.test(n))).toBe(true);
  });

  it("says the difference is within tolerance rather than implying a dispute", () => {
    const f = auditSku(amazon, real, opts);
    expect(f.confidence).toBe("low");
    expect(f.notes.some((n) => /within measurement tolerance/i.test(n))).toBe(true);
  });

  it("raises confidence when the weight gap is beyond tolerance", () => {
    // 0.35 lb heavier is well past the 0.1 lb tolerance — worth disputing.
    const f = auditSku({ ...amazon, itemPackageWeight: 3.07 }, real, opts);
    expect(["overcharge", "measurement_variance"]).toContain(f.status);
    expect(f.confidence).not.toBe("low");
  });

  it("does not flag a variance when Amazon measured LIGHTER than your box", () => {
    const f = auditSku({ ...amazon, itemPackageWeight: 2.6, expectedFulfillmentFee: 6.48 }, real, opts);
    expect(f.status).not.toBe("measurement_variance");
  });

  it("still catches a genuine hazmat mis-charge", () => {
    // Same measurements on both sides, so there is no band ambiguity: Amazon's
    // charge matches the hazmat schedule and nothing else.
    const f = auditSku(
      { ...amazon, itemPackageWeight: 2.72, expectedFulfillmentFee: 6.96 },
      real,
      opts,
    );
    expect(f.notes.some((n) => /Dangerous Goods/i.test(n))).toBe(true);
    expect(f.status).toBe("overcharge");
  });
});
