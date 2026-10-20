import { describe, expect, it } from "vitest";
import { BUILT_IN_SIPP_DISCOUNTS, calculateFBATierAndFee, type FeeTableOverride } from "./fbaFees";
import { auditSku, type AmazonMeasuredRow, type RealMeasurement } from "./feeAudit";

// A splash-pad-shaped box: 12 x 8 x 3 in, 2.9 lb -> large standard, 2.75+ to 3 lb.
const IN = 2.54;
const LB = 0.453592;
const box = [12 * IN, 8 * IN, 3 * IN, 2.9 * LB] as const;

// The published $10-$50 rate for that band, as parsed from the fee page.
const card: FeeTableOverride = {
  regular: [
    {
      tier: "large standard",
      weightRange: "2.75+ to 3 lb",
      nonPeak: 6.67,
      peak: 6.67,
      weightBasis: "Greater of unit or dimensional weight",
    },
  ],
  hazmat: [],
};

describe("SIPP in the fee engine", () => {
  it("leaves SIPP out entirely when certification isn't stated", () => {
    const r = calculateFBATierAndFee(...box, 25.99, false, card);
    expect(r.sipp).toBeUndefined();
  });

  it("reports the discount for a certified unit without folding it into the base fee", () => {
    // Amazon takes it off after the fuel surcharge, so the base must stay whole.
    const r = calculateFBATierAndFee(...box, 25.99, false, card, true);
    expect(r.feeNonPeak).toBe(6.67);
    expect(r.sipp).toEqual({ status: "discount", amount: -0.14, source: "built-in" });
  });

  it("uses a pasted SIPP card in preference to the built-in table", () => {
    const withSipp: FeeTableOverride = {
      ...card,
      sipp: [{ ...card.regular[0], nonPeak: 0.2, peak: 0.2 }],
    };
    const r = calculateFBATierAndFee(...box, 25.99, false, withSipp, true);
    expect(r.sipp).toEqual({ status: "discount", amount: -0.2, source: "published" });
  });

  it("won't apply a general SIPP discount to a Dangerous Goods fee", () => {
    const r = calculateFBATierAndFee(...box, 25.99, true, card, true);
    expect(r.sipp?.status).toBe("no_rate");
    expect(r.sipp?.amount).toBe(0);
  });

  it("adds the packaging fee to a bulky unit that isn't certified", () => {
    // 25 x 15 x 8 in, 12 lb -> large bulky, ~21.6 lb dimensional weight.
    const bulky = [25 * IN, 15 * IN, 8 * IN, 12 * LB] as const;
    const withFee: FeeTableOverride = {
      regular: [
        {
          tier: "large bulky",
          weightRange: "0 to 50 lb",
          nonPeak: 9.35,
          peak: 9.35,
          weightBasis: "Greater of unit or dimensional weight",
        },
      ],
      hazmat: [],
      nonSippPackaging: [
        {
          tier: "large bulky",
          weightRange: "0 to 50 lb",
          nonPeak: 2.07,
          peak: 2.07,
          weightBasis: "Greater of unit or dimensional weight",
        },
      ],
    };
    const r = calculateFBATierAndFee(...bulky, 40, false, withFee, false);
    expect(r.sipp).toEqual({ status: "packaging_fee", amount: 2.07, source: "published" });
  });
});

describe("the built-in SIPP table", () => {
  it("drops the large bulky discount Amazon withdrew on 15 Jan 2026", () => {
    expect(BUILT_IN_SIPP_DISCOUNTS.some((r) => r.tier === "large bulky")).toBe(false);
  });

  it("spells the top large-standard band so the band matcher can read it", () => {
    // Written "3+ lb to 20 lb" it matched no weight at all.
    expect(BUILT_IN_SIPP_DISCOUNTS.some((r) => r.weightRange === "3+ to 20 lb")).toBe(true);
    const heavy = [12 * IN, 8 * IN, 3 * IN, 3.46 * LB] as const;
    expect(calculateFBATierAndFee(...heavy, 39.99, false, undefined, true).sipp?.amount).toBe(-0.23);
  });
});

describe("SIPP in the audit", () => {
  const real = (sippCertified?: boolean): RealMeasurement => ({
    sku: "SPLASH",
    lengthCm: box[0],
    widthCm: box[1],
    heightCm: box[2],
    weightKg: box[3],
    sippCertified,
    unitsSold: 100,
  });
  const billed = (fee: number): AmazonMeasuredRow => ({
    sku: "SPLASH",
    yourPrice: 25.99,
    longestSide: 12,
    medianSide: 8,
    shortestSide: 3,
    unitOfDimension: "inches",
    itemPackageWeight: 2.9,
    unitOfWeight: "pounds",
    productSizeTier: "Large standard-size",
    expectedFulfillmentFee: fee,
  });

  it("takes the discount off after the fuel surcharge, matching Amazon to the cent", () => {
    // $6.67 x 1.035 - $0.14 = $6.76, which is what Amazon bills SEZ0101012.
    const f = auditSku(billed(6.76), real(true), { feeTable: card });
    expect(f.correctFee).toBe(6.76);
    expect(f.sippDiscount).toBe(0.14);
    expect(f.status).toBe("ok");
    expect(f.notes.join(" ")).toMatch(/SIPP-certified: \$0\.14\/unit discount included/);
  });

  it("flags a certified unit billed the full rate - the discount is owed", () => {
    // With Amazon's measurement matching the box, the ordinary check would file a
    // $0.14 gap as rate-table noise and call it OK; only the SIPP check sees
    // that it's a discount Amazon owes.
    const f = auditSku(billed(6.9), real(true), { feeTable: card });
    expect(f.status).toBe("overcharge");
    expect(f.recoverablePerUnit).toBe(0.14);
    expect(f.recoverableTotal).toBe(14);
    expect(f.notes.join(" ")).toMatch(/no SIPP discount/);
  });

  it("points out a listing Amazon already bills as SIPP but that isn't ticked", () => {
    const f = auditSku(billed(6.76), real(false), { feeTable: card });
    expect(f.correctFee).toBe(6.9); // not certified here, so no discount assumed
    expect(f.status).toBe("ok");
    expect(f.notes.join(" ")).toMatch(/exactly as a SIPP-certified unit/);
  });

  it("says nothing about SIPP for a unit billed the full rate and not certified", () => {
    const f = auditSku(billed(6.9), real(false), { feeTable: card });
    expect(f.status).toBe("ok");
    expect(f.notes.join(" ")).not.toMatch(/SIPP/);
  });
});

describe("SIPP packaging fee, from Amazon's own worked example", () => {
  // "Large bulky non-SIPP enrolled - Book Shelf: 37.58 x 12.27 x 5.74 inches,
  //  dimensional weight 19.04 lb, unit weight 30.31 lb ... packaging fee $2.60"
  const shelf = [37.58 * IN, 12.27 * IN, 5.74 * IN, 30.31 * LB] as const;
  const band = (range: string, fee: number) => ({
    tier: "large bulky",
    weightRange: range,
    nonPeak: fee,
    peak: fee,
    weightBasis: "Dimensional weight",
  });
  const table: FeeTableOverride = {
    regular: [
      {
        tier: "large bulky",
        weightRange: "0+ to 50 lb",
        nonPeak: 9.35,
        peak: 9.35,
        weightBasis: "Greater of unit or dimensional weight",
        surchargePerInterval: 0.38,
        surchargeIntervalLb: 1,
        surchargeAboveLb: 1,
      },
    ],
    hazmat: [],
    nonSippPackaging: [band("15+ to 20 lb", 2.6), band("30+ to 35 lb", 3.6)],
  };

  it("sizes the packaging fee by dimensional weight, not shipping weight", () => {
    // Shipping weight is 30.31 lb (the unit weight), which would be $3.60.
    const r = calculateFBATierAndFee(...shelf, 30, false, table, false);
    expect(r.tier.toLowerCase()).toBe("large bulky");
    expect(r.dimWeight).toBeCloseTo(19.04, 1);
    expect(r.sipp).toEqual({ status: "packaging_fee", amount: 2.6, source: "published" });
  });

  it("charges no packaging fee - and warns of no missing rate - for a certified bulky unit", () => {
    const r = calculateFBATierAndFee(...shelf, 30, false, table, true);
    expect(r.sipp).toEqual({ status: "none", amount: 0 });
  });
});
