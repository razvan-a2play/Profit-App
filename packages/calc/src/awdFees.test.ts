import { describe, expect, it } from "vitest";
import { awdFeeRates, awdStorageCost } from "./awdFees";
import { US_2026, US_2027 } from "./feeSchedules";

describe("AWD fee rates (Seller Central GAYG62Q3MPE6STFS)", () => {
  it("2026: $1.40 in + $1.40 out per box, $1.40 per cu ft, no surcharge", () => {
    const r = awdFeeRates(US_2026);
    expect(r.processingPerBox).toBeCloseTo(2.8, 10);
    expect(r.transportationPerCuft).toBeCloseTo(1.4, 10);
  });

  it("2027: $1.55 in + $1.55 out per box, $1.58 per cu ft + 3.5% surcharge", () => {
    const r = awdFeeRates(US_2027);
    expect(r.processingPerBox).toBeCloseTo(3.1, 10);
    // Amazon's own example: 3.5% x $1.58 = $0.06 per cu ft.
    expect(r.transportationPerCuft - r.transportationBasePerCuft).toBeCloseTo(0.0553, 4);
    expect(r.transportationPerCuft).toBeCloseTo(1.6353, 4);
  });

  it("storage under 12 months is the same in both years", () => {
    expect(awdStorageCost(0.5, 0.48, 3, US_2026)).toBeCloseTo(0.72, 10);
    expect(awdStorageCost(0.5, 0.48, 3, US_2027)).toBeCloseTo(0.72, 10);
    expect(awdStorageCost(0.5, 0.48, 12, US_2027)).toBeCloseTo(2.88, 10);
  });

  it("2027: months past 12 pay 2.5x ($0.48 -> $1.20 per cu ft, Amazon's FAQ)", () => {
    // 14 months at $0.48: 12 x 0.48 + 2 x 1.20 = 8.16 per cu ft.
    expect(awdStorageCost(1, 0.48, 14, US_2027)).toBeCloseTo(8.16, 10);
    expect(awdStorageCost(1, 0.48, 14, US_2026)).toBeCloseTo(6.72, 10);
    // Discount tiers keep their discount on the aged rate: $0.51 x 2.5 = $1.275.
    expect(awdStorageCost(1, 0.51, 13, US_2027) - awdStorageCost(1, 0.51, 12, US_2027)).toBeCloseTo(1.275, 10);
  });

  it("no volume, rate or months: no storage", () => {
    expect(awdStorageCost(0, 0.48, 3, US_2027)).toBe(0);
    expect(awdStorageCost(1, 0.48, 0, US_2027)).toBe(0);
  });
});
