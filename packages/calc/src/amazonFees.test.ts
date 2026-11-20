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
  it("uses 2026 rates until Jan 14, 2027 and 2027 rates from Jan 15", () => {
    expect(resolveFeeSchedule("auto", new Date(2026, 10, 18)).schedule.id).toBe("us-2026");
    expect(resolveFeeSchedule("auto", new Date(2027, 0, 14)).schedule.id).toBe("us-2026");
    const jan15 = resolveFeeSchedule("auto", new Date(2027, 0, 15));
    expect(jan15.schedule.id).toBe("us-2027");
    expect(jan15.fellBackFrom).toBeUndefined();
  });

  it("lets you price with 2027 rates before they start", () => {
    expect(US_2027.status).toBe("ready");
    expect(resolveFeeSchedule("us-2027", new Date(2026, 10, 18)).schedule.id).toBe("us-2027");
  });

  it("never picks a schedule without rates", () => {
    expect(scheduleInEffect(new Date(2030, 0, 1)).status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// Amazon's own worked examples (Seller Central, read Nov 20, 2026). Inches and
// pounds as Amazon prints them; fees before the fuel surcharge.
// ---------------------------------------------------------------------------

const amz = (l: number, w: number, h: number, lb: number, price: number, extra: object = {}) => ({
  length: l * 2.54,
  width: w * 2.54,
  height: h * 2.54,
  weight: lb * 0.453592,
  sellingPrice: price,
  category: "toys and games",
  ...extra,
});

describe("Amazon's 2027 examples (2027 US FBA fulfillment fee changes)", () => {
  const cases: Array<[string, ReturnType<typeof amz>, string, number, number]> = [
    // name, input, tier, 2026 non-peak, 2027 non-peak
    ["Iron", amz(12.6, 6.6, 5.5, 3.35, 25), "Large standard", 7.13, 7.32],
    ["Baby cot", amz(24, 7.5, 6, 7.9, 60), "Small bulky", 10.21, 10.24],
    ["Monitor", amz(54, 34, 3.5, 41, 30), "Small oversize", 43.81, 27.1],
    ["TV", amz(65, 20, 7, 62, 60), "Medium oversize", 48.57, 36.55],
    ["Wall panel", amz(60, 30, 3, 25, 60), "Small oversize", 40.77, 24.86],
    ["Tabletop panel", amz(70, 44, 3, 50, 60), "Long oversize", 49.32, 83.55],
    ["Vent cover filter", amz(18, 17.75, 2.75, 4.44, 30), "Small bulky", 9.83, 9.85],
    ["Shoe storage bench", amz(47.5, 17.25, 4.38, 25, 30), "Large bulky", 18.85, 19.63],
    ["Book shelf", amz(37.58, 12.27, 5.74, 30.31, 30), "Large bulky", 20.75, 21.58],
  ];

  for (const [name, input, tier2027, fee2026, fee2027] of cases) {
    it(`${name}: 2026 $${fee2026}, 2027 $${fee2027}`, () => {
      expect(computeAmazonFbaFees(input, US_2026).fulfillmentNonPeak).toBeCloseTo(fee2026, 2);
      const f = computeAmazonFbaFees(input, US_2027);
      expect(f.tier).toBe(tier2027);
      expect(f.fulfillmentNonPeak).toBeCloseTo(fee2027, 2);
    });
  }

  it("small-standard phone case under $10: $2.49 -> $2.72", () => {
    const c = amz(13.8, 9, 0.7, 2.88 / 16, 8);
    expect(computeAmazonFbaFees(c, US_2026).fulfillmentNonPeak).toBe(2.49);
    expect(computeAmazonFbaFees(c, US_2027).fulfillmentNonPeak).toBe(2.72);
  });
});

describe("2027 oversize handling fees (Oversize handling fees page)", () => {
  it("wall panel: + $8.40 flat-product fee = $33.26", () => {
    const f = computeAmazonFbaFees(amz(60, 30, 3, 25, 60), US_2027);
    expect(f.handlingFee).toBe(8.4);
    expect(f.fulfillmentNonPeak + f.handlingFee).toBeCloseTo(33.26, 2);
  });

  it("tabletop panel: + $10.48 flat + $3.45 overhang = $97.48", () => {
    const f = computeAmazonFbaFees(amz(70, 44, 3, 50, 60), US_2027);
    expect(f.handlingFee).toBeCloseTo(13.93, 2);
    expect(f.fulfillmentNonPeak + f.handlingFee).toBeCloseTo(97.48, 2);
  });

  it("no handling fees in 2026", () => {
    expect(computeAmazonFbaFees(amz(60, 30, 3, 25, 60), US_2026).handlingFee).toBe(0);
  });
});

describe("2027 packaging fee and SIPP (SIPP fulfillment fee page)", () => {
  it("non-SIPP baby cot pays $1.68 packaging: $11.92", () => {
    const f = computeAmazonFbaFees(amz(24, 7.5, 6, 7.9, 30, { sippEligibleOverride: false }), US_2027);
    expect(f.packagingFee).toBe(1.68);
    expect(f.fulfillmentNonPeak + f.packagingFee).toBeCloseTo(11.92, 2);
  });

  it("non-SIPP book shelf pays $2.60 packaging (by dimensional weight): $24.18", () => {
    const f = computeAmazonFbaFees(amz(37.58, 12.27, 5.74, 30.31, 30, { sippEligibleOverride: false }), US_2027);
    expect(f.packagingFee).toBe(2.6);
    expect(f.fulfillmentNonPeak + f.packagingFee).toBeCloseTo(24.18, 2);
  });

  it("SIPP vent cover filter pays no packaging fee", () => {
    expect(computeAmazonFbaFees(amz(18, 17.75, 2.75, 4.44, 30), US_2027).packagingFee).toBe(0);
  });
});

describe("2027 Low-Price FBA eligibility", () => {
  it("an excluded category under $10 pays the $10-$50 rate in 2027 only", () => {
    const pc = { ...tiny, sellingPrice: 8, category: "computers" };
    expect(computeAmazonFbaFees(pc, US_2026).fulfillmentNonPeak).toBe(2.43);
    const f = computeAmazonFbaFees(pc, US_2027);
    expect(f.lowPriceExcluded).toBe(true);
    expect(f.fulfillmentNonPeak).toBe(3.75);
  });

  it("toys under $10 keep the Low-Price rate", () => {
    const f = computeAmazonFbaFees({ ...tiny, sellingPrice: 8 }, US_2027);
    expect(f.lowPriceExcluded).toBe(false);
    expect(f.fulfillmentNonPeak).toBe(2.64);
  });
});

describe("2027 peak estimate", () => {
  it("adds 2026's peak markup to the 2027 rate until Amazon publishes 2027 peak", () => {
    const f = computeAmazonFbaFees({ ...tiny, sellingPrice: 25 }, US_2027);
    // 3.75 + (3.51 - 3.32)
    expect(f.fulfillmentPeak).toBeCloseTo(3.94, 2);
  });
});

describe("returns processing fee for the 2027 tiers", () => {
  it("maps bulky and oversize tiers onto Amazon's return rates", () => {
    // Baby cot example: $8.98 for units shipped from Feb 1, 2027.
    expect(calculateReturnProcessingFee("Small bulky", 7.9 * 16)).toBeCloseTo(8.98, 2);
    expect(calculateReturnProcessingFee("Medium bulky", 7.9 * 16)).toBeCloseTo(8.98, 2);
    expect(calculateReturnProcessingFee("Small oversize", 40 * 16)).toBeCloseTo(26.33 + 39 * 0.38, 2);
    expect(calculateReturnProcessingFee("Long oversize", 80 * 16)).toBeCloseTo(52.45 + 9 * 0.75, 2);
  });
});
