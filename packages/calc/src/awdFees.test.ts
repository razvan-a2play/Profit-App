import { describe, expect, it } from "vitest";
import { awdFeeRates, awdStorageCost, type AwdSetup } from "./awdFees";
import { US_2026, US_2027 } from "./feeSchedules";

// Seller Central "Amazon Warehousing and Distribution fees" (GAYG62Q3MPE6STFS).
const east: AwdSetup = { location: "east-south", tier: "base" };
const wcpBox: AwdSetup = { location: "wcp-carton", tier: "base" };
const wcpPallet: AwdSetup = { location: "wcp-pallet", tier: "base" };

describe("AWD processing and transportation", () => {
  it("2026: $1.40 in + $1.40 out per box, $1.40 per cu ft, no surcharge", () => {
    const r = awdFeeRates(US_2026, east);
    expect(r.processingPerBox).toBeCloseTo(2.8, 10);
    expect(r.transportationPerCuft).toBeCloseTo(1.4, 10);
  });

  it("2027: $1.55 in + $1.55 out per box, $1.58 per cu ft + 3.5% surcharge", () => {
    const r = awdFeeRates(US_2027, east);
    expect(r.processingPerBox).toBeCloseTo(3.1, 10);
    // Amazon's own example: 3.5% x $1.58 = $0.06 per cu ft.
    expect(r.transportationPerCuft - r.transportationBasePerCuft).toBeCloseTo(0.0553, 4);
    expect(r.transportationPerCuft).toBeCloseTo(1.6353, 4);
  });

  it("West Coast Palletizable receives boxes for less", () => {
    expect(awdFeeRates(US_2026, wcpBox).inboundPerBox).toBe(1.05);
    expect(awdFeeRates(US_2026, wcpPallet).inboundPerBox).toBe(1.05);
    expect(awdFeeRates(US_2027, wcpBox).inboundPerBox).toBe(1.16);
    expect(awdFeeRates(US_2027, wcpPallet).inboundPerBox).toBe(0.93);
    // Outbound is never discounted.
    expect(awdFeeRates(US_2027, wcpPallet).processingPerBox).toBeCloseTo(0.93 + 1.55, 10);
  });

  it("Amazon managed transportation: $1.26 in 2026, no discount in 2027", () => {
    expect(awdFeeRates(US_2026, { location: "east-south", tier: "managed" }).transportationPerCuft).toBe(1.26);
    expect(awdFeeRates(US_2027, { location: "east-south", tier: "managed" }).transportationBasePerCuft).toBe(1.58);
  });
});

describe("AWD storage", () => {
  it("West Coast (incl. Palletizable) $0.57, East/South $0.48, same in both years", () => {
    expect(awdFeeRates(US_2026, wcpBox).storagePerCuftMonth).toBe(0.57);
    expect(awdFeeRates(US_2027, wcpPallet).storagePerCuftMonth).toBe(0.57);
    expect(awdFeeRates(US_2027, east).storagePerCuftMonth).toBe(0.48);
    expect(awdFeeRates(US_2027, { location: "wcp-carton", tier: "smart" }).storagePerCuftMonth).toBe(0.51);
    expect(awdStorageCost(0.5, 3, US_2026, east)).toBeCloseTo(0.72, 10);
    expect(awdStorageCost(0.5, 3, US_2027, east)).toBeCloseTo(0.72, 10);
  });

  it("2027: months past 12 pay Amazon's aged rate", () => {
    // 14 months East base: 12 x 0.48 + 2 x 1.20 = 8.16 per cu ft.
    expect(awdStorageCost(1, 14, US_2027, east)).toBeCloseTo(8.16, 10);
    expect(awdStorageCost(1, 14, US_2026, east)).toBeCloseTo(6.72, 10);
    // West Coast smart storage aged rate: $1.28.
    const smartWest: AwdSetup = { location: "wcp-carton", tier: "smart" };
    expect(awdStorageCost(1, 13, US_2027, smartWest) - awdStorageCost(1, 12, US_2027, smartWest)).toBeCloseTo(1.28, 10);
  });

  it("no volume or months: no storage", () => {
    expect(awdStorageCost(0, 3, US_2027, east)).toBe(0);
    expect(awdStorageCost(1, 0, US_2027, east)).toBe(0);
  });
});
