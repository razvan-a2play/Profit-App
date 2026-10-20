import { describe, it, expect } from "vitest";
import { toAgedSku, rankAged, totalAged } from "./agedInventory";
import type { AgedRow } from "./amazonInventory";

const row = (p: Partial<AgedRow>): AgedRow => ({
  sku: "SKU",
  asin: null,
  productName: null,
  yourPrice: null,
  age0_90: 0,
  age91_180: 0,
  age181_270: 0,
  age271_330: 0,
  age331_365: 0,
  age365Plus: 0,
  totalUnits: 0,
  ltsfActiveUnits: 0,
  ltsfRiskUnits: 0,
  aisMonthly: 0,
  aisUnits: 0,
  itemVolumeCuFt: null,
  unitsShippedT30: 0,
  unitsShippedT90: 0,
  daysOfSupply: null,
  ...p,
});

describe("the surcharge is Amazon's number, not ours", () => {
  it("reports what Amazon says it will charge", () => {
    // The surcharge is priced per CUBIC FOOT. Deriving it from unit counts and
    // a per-unit rate overstated this catalogue tenfold, so the figure is taken
    // straight from the report and never recomputed.
    const s = toAgedSku(row({ age365Plus: 33, totalUnits: 33, aisMonthly: 25.09, aisUnits: 33 }));
    expect(s.monthlyLtsf).toBe(25.09);
    expect(s.chargedUnits).toBe(33);
  });

  it("does not invent a charge when Amazon reports none", () => {
    const s = toAgedSku(row({ age181_270: 116, totalUnits: 116, aisMonthly: 0 }));
    expect(s.monthlyLtsf).toBe(0);
  });
});

describe("toAgedSku", () => {
  it("separates what is being charged from what is next in line", () => {
    const s = toAgedSku(
      row({ age91_180: 100, age181_270: 10, totalUnits: 110, aisMonthly: 5, itemVolumeCuFt: 0.1 }),
    );
    expect(s.activeUnits).toBe(10);
    expect(s.riskUnits).toBe(100);
    expect(s.monthlyLtsf).toBe(5);
    // 100 units x 0.1 cu ft x $0.50 per cu ft at the entry tier — NOT 100 x $0.50.
    expect(s.projectedMonthlyLtsf).toBe(5);
  });

  it("declines to project when Amazon gives no volume", () => {
    // A per-unit guess here would be ~10x out, so say nothing instead.
    const s = toAgedSku(row({ age91_180: 100, totalUnits: 100, itemVolumeCuFt: null }));
    expect(s.projectedMonthlyLtsf).toBeNull();
  });

  it("values only the aged units, not the whole shelf", () => {
    const s = toAgedSku(row({ age0_90: 900, age365Plus: 10, totalUnits: 910, yourPrice: 12.5 }));
    expect(s.agedRetailValue).toBe(125); // 10 x 12.50, not 910 x 12.50
  });

  it("survives a SKU with no price rather than reporting NaN", () => {
    const s = toAgedSku(row({ age365Plus: 4, totalUnits: 4, yourPrice: null, aisMonthly: 3.04 }));
    expect(s.agedRetailValue).toBe(0);
    expect(s.monthlyLtsf).toBe(3.04);
  });

  it("names the oldest bucket that actually holds units", () => {
    expect(toAgedSku(row({ age0_90: 5, age271_330: 1 })).oldestBucket).toBe("271-330 days");
    expect(toAgedSku(row({ age0_90: 5 })).oldestBucket).toBe("0-90 days");
    expect(toAgedSku(row({})).oldestBucket).toBeNull();
  });
});

describe("rankAged", () => {
  it("puts the biggest bill first, not the biggest pile", () => {
    const big = toAgedSku(row({ sku: "BIG", age0_90: 50_000, totalUnits: 50_000 }));
    const old = toAgedSku(row({ sku: "OLD", age365Plus: 30, totalUnits: 30, aisMonthly: 22.8 }));
    expect(rankAged([big, old]).map((r) => r.sku)).toEqual(["OLD", "BIG"]);
  });

  it("falls back to what is about to age when nothing is charged yet", () => {
    const soon = toAgedSku(
      row({ sku: "SOON", age91_180: 500, totalUnits: 500, itemVolumeCuFt: 0.1 }),
    );
    const idle = toAgedSku(row({ sku: "IDLE", age0_90: 9_000, totalUnits: 9_000 }));
    expect(rankAged([idle, soon]).map((r) => r.sku)).toEqual(["SOON", "IDLE"]);
  });
});

describe("totalAged", () => {
  it("adds the buckets and the money the same way", () => {
    const rows = [
      toAgedSku(
        row({ sku: "A", age91_180: 100, age181_270: 10, totalUnits: 110, yourPrice: 10,
              aisMonthly: 5, itemVolumeCuFt: 0.1 }),
      ),
      toAgedSku(row({ sku: "B", age365Plus: 5, totalUnits: 5, yourPrice: 20, aisMonthly: 3.8 })),
    ];
    const t = totalAged(rows);
    expect(t.skus).toBe(2);
    expect(t.totalUnits).toBe(115);
    expect(t.activeUnits).toBe(15);
    expect(t.riskUnits).toBe(100);
    expect(t.monthlyLtsf).toBeCloseTo(8.8, 2);
    expect(t.annualLtsf).toBeCloseTo(105.6, 2);
    expect(t.projectedMonthlyLtsf).toBeCloseTo(5, 2);
    expect(t.agedRetailValue).toBe(10 * 10 + 5 * 20);
  });

  it("reports zeros rather than NaN for an empty warehouse", () => {
    const t = totalAged([]);
    expect(t.totalUnits).toBe(0);
    expect(t.monthlyLtsf).toBe(0);
    expect(t.annualLtsf).toBe(0);
  });
});

describe("will these actually cross the threshold", () => {
  it("counts the units Amazon says it will charge but that are not aged yet", () => {
    // SPBATH0030's real shape: nothing aged today, 106 units charged next time.
    const s = toAgedSku(row({ age91_180: 106, totalUnits: 106, aisUnits: 106, aisMonthly: 1.82 }));
    expect(s.activeUnits).toBe(0);
    expect(s.crossingUnits).toBe(106);
  });

  it("never reports a negative crossing when Amazon charges fewer than are aged", () => {
    const s = toAgedSku(row({ age365Plus: 50, totalUnits: 50, aisUnits: 20 }));
    expect(s.crossingUnits).toBe(0);
  });

  it("says how long the crossing units take to sell, at the better recent rate", () => {
    // 30 units crossing, 90 in the last 90 days (1/day) vs 60 in 30 (2/day).
    const s = toAgedSku(
      row({ age91_180: 30, totalUnits: 30, aisUnits: 30, unitsShippedT30: 60, unitsShippedT90: 90 }),
    );
    expect(s.daysToClearCrossing).toBe(15);
  });

  it("declines to answer for a SKU with no sales rather than dividing by zero", () => {
    const s = toAgedSku(row({ age91_180: 40, totalUnits: 40, aisUnits: 40 }));
    expect(s.daysToClearCrossing).toBeNull();
  });

  it("has nothing to say when nothing is crossing", () => {
    const s = toAgedSku(row({ age0_90: 500, totalUnits: 500, unitsShippedT30: 300 }));
    expect(s.crossingUnits).toBe(0);
    expect(s.daysToClearCrossing).toBeNull();
  });
});
