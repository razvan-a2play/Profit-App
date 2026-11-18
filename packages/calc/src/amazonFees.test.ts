import { describe, expect, it } from "vitest";
import { computeAmazonFbaFees, BATTERY_FEE_PER_UNIT } from "./amazonFees";
import {
  US_2026,
  US_2027,
  priceBandOf,
  resolveFeeSchedule,
  scheduleInEffect,
} from "./feeSchedules";
import { calculateReturnProcessingFee } from "./fbaFees";

// 5 x 5 x 1 cm, 50 g -> small standard, 2 oz or less. Too small for SIPP.
const tiny = { length: 5, width: 5, height: 1, weight: 0.05, category: "toys and games" };

describe("price columns (US 2026)", () => {
  it("charges a $10-$50 item the $10-$50 rate, not the under-$10 one", () => {
    const f = computeAmazonFbaFees({ ...tiny, sellingPrice: 25 }, US_2026);
    expect(f.tier).toBe("Small standard");
    expect(f.priceBand).toBe("mid");
    expect(f.fulfillmentNonPeak).toBe(3.32);
    expect(f.fulfillmentPeak).toBe(3.51);
  });

  it("charges an under-$10 item the Low-Price rate, with no extra discount", () => {
    const f = computeAmazonFbaFees({ ...tiny, sellingPrice: 8 }, US_2026);
    expect(f.priceBand).toBe("low");
    expect(f.fulfillmentNonPeak).toBe(2.43);
    expect(f.fulfillmentPeak).toBe(2.62);
  });

  it("charges an over-$50 item the over-$50 rate", () => {
    const f = computeAmazonFbaFees({ ...tiny, sellingPrice: 60 }, US_2026);
    expect(f.priceBand).toBe("high");
    expect(f.fulfillmentNonPeak).toBe(3.58);
  });

  it("treats exactly $10 and $50 as the $10-$50 column", () => {
    expect(priceBandOf(10)).toBe("mid");
    expect(priceBandOf(50)).toBe("mid");
    expect(priceBandOf(9.99)).toBe("low");
    expect(priceBandOf(50.01)).toBe("high");
  });
});

describe("surcharge and SIPP, in Amazon's order", () => {
  it("reproduces SEZ0101011's measured Amazon charge of $7.15", () => {
    // 30 x 20 x 10 cm, 1.5 kg = 3.31 lb -> large standard 3+ lb, 2 x 4-oz
    // intervals: 6.97 + 0.16 = 7.13. x 1.035 = 7.38, less $0.23 SIPP = 7.15.
    const f = computeAmazonFbaFees(
      { length: 30, width: 20, height: 10, weight: 1.5, sellingPrice: 30, category: "toys and games" },
      US_2026,
    );
    expect(f.tier).toBe("Large standard");
    expect(f.fulfillmentNonPeak).toBeCloseTo(7.13, 2);
    expect(f.surchargeNonPeak).toBe(0.25);
    expect(f.sippCertified).toBe(true);
    expect(f.sippDiscount).toBe(0.23);
    expect(f.fbaNonPeak).toBeCloseTo(7.15, 2);
  });

  it("drops SIPP when the user switches it off", () => {
    const f = computeAmazonFbaFees(
      {
        length: 30, width: 20, height: 10, weight: 1.5, sellingPrice: 30,
        category: "toys and games", sippEligibleOverride: false,
      },
      US_2026,
    );
    expect(f.sippDiscount).toBe(0);
    expect(f.fbaNonPeak).toBeCloseTo(7.38, 2);
  });

  it("weights 9 months non-peak and 3 months peak", () => {
    const f = computeAmazonFbaFees({ ...tiny, sellingPrice: 25 }, US_2026);
    expect(f.fbaWeighted).toBeCloseTo((f.fbaNonPeak * 9 + f.fbaPeak * 3) / 12, 6);
    expect(f.totalWeighted).toBeCloseTo(f.fbaWeighted + f.referralFee, 6);
  });

  it("adds the battery fee only when flagged", () => {
    const plain = computeAmazonFbaFees({ ...tiny, sellingPrice: 25 }, US_2026);
    const batt = computeAmazonFbaFees({ ...tiny, sellingPrice: 25, containsBatteries: true }, US_2026);
    expect(batt.fbaNonPeak - plain.fbaNonPeak).toBeCloseTo(BATTERY_FEE_PER_UNIT, 6);
  });

  it("charges nothing when dimensions are missing", () => {
    const f = computeAmazonFbaFees({ ...tiny, length: 0, sellingPrice: 25 }, US_2026);
    expect(f.fbaNonPeak).toBe(0);
    expect(f.fbaWeighted).toBe(0);
  });
});

describe("dangerous goods (US 2026)", () => {
  it("uses the DG table for the price column", () => {
    const f = computeAmazonFbaFees({ ...tiny, sellingPrice: 25, hazmat: true }, US_2026);
    expect(f.fulfillmentNonPeak).toBe(4.29);
    expect(f.fulfillmentPeak).toBe(4.63);
  });
});

describe("bulky packaging fee", () => {
  // 60 x 40 x 30 cm, 6 kg -> small bulky, ~31.6 lb dimensional weight.
  const box = { length: 60, width: 40, height: 30, weight: 6, sellingPrice: 40, category: "toys and games" };

  it("charges Amazon's packaging fee when the bulky unit is not SIPP-certified", () => {
    const f = computeAmazonFbaFees({ ...box, sippEligibleOverride: false }, US_2026);
    const certified = computeAmazonFbaFees(box, US_2026);
    expect(f.fbaNonPeak - certified.fbaNonPeak).toBeCloseTo(3.6, 2); // 30+ to 35 lb band
  });
});

describe("bulky tiers (US 2026)", () => {
  it("classifies a box over large-standard size as small bulky", () => {
    // 60 x 40 x 30 cm, 6 kg -> 23.6 x 15.7 x 11.8 in: past 18 x 14 x 8.
    const f = computeAmazonFbaFees(
      { length: 60, width: 40, height: 30, weight: 6, sellingPrice: 40, category: "toys and games" },
      US_2026,
    );
    expect(f.tier).toBe("Small bulky");
    const intervals = Math.ceil(f.billableWeight - 1);
    expect(f.fulfillmentNonPeak).toBeCloseTo(7.55 + intervals * 0.38, 2);
    expect(f.returnProcessingFee).toBeGreaterThan(0);
  });

  it("prices an extra-large return instead of returning $0", () => {
    expect(calculateReturnProcessingFee("Extra-large", 40 * 16)).toBeCloseTo(26.33 + 39 * 0.38, 2);
    expect(calculateReturnProcessingFee("Extra-large", 60 * 16)).toBeCloseTo(40.12 + 9 * 0.75, 2);
  });
});

describe("choosing a schedule", () => {
  it("uses 2026 rates today", () => {
    const r = resolveFeeSchedule("auto", new Date(2026, 10, 18));
    expect(r.schedule.id).toBe("us-2026");
    expect(r.fellBackFrom).toBeUndefined();
  });

  it("falls back to 2026, and says so, while 2027 rates are pending", () => {
    expect(US_2027.status).toBe("pending");
    const asked = resolveFeeSchedule("us-2027", new Date(2026, 10, 18));
    expect(asked.schedule.id).toBe("us-2026");
    expect(asked.fellBackFrom?.id).toBe("us-2027");

    const afterJan15 = resolveFeeSchedule("auto", new Date(2027, 1, 1));
    expect(afterJan15.schedule.id).toBe("us-2026");
    expect(afterJan15.fellBackFrom?.id).toBe("us-2027");
  });

  it("never picks a schedule without rates", () => {
    expect(scheduleInEffect(new Date(2030, 0, 1)).status).toBe("ready");
  });
});
