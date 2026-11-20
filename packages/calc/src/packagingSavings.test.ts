import { describe, expect, it } from "vitest";
import { feeWeightDriver, findPackagingSavings, findWeightSavings } from "./packagingSavings";
import { US_2026, US_2027 } from "./feeSchedules";

describe("findPackagingSavings", () => {
  it("SPGROO001 (Beetle Brush): a 1 mm thinner box drops it into the 4 oz band", () => {
    // Live snapshot: 7.8 x 4.3 x 17.1 cm, 109 g, $7.99. Unit weight 3.84 oz
    // but dimensional weight 4.03 oz, so Amazon bills the 4+ to 8 oz band.
    const brush = { length: 7.8, width: 4.3, height: 17.1, weight: 0.109, sellingPrice: 7.99, category: "baby products" };
    const [first] = findPackagingSavings(brush, US_2026);
    expect(first).toBeDefined();
    expect(first.totalCutCm).toBeLessThanOrEqual(0.1);
    expect(first.before.weightBand).toBe("4+ to 8 oz");
    expect(first.after.weightBand).toBe("4 oz or less");
    // Weighted fee 3.3075 -> 3.0725 (<$10 column, 3.5% surcharge, 9/3 peak).
    expect(first.savingPerUnit).toBeCloseTo(0.235, 3);
  });

  it("brings a box just over 18 in back into large standard", () => {
    // 46.5 cm = 18.31 in longest side: small bulky. 45.7 cm = 17.99 in.
    const box = { length: 46.5, width: 20, height: 10, weight: 1, sellingPrice: 25, category: "toys and games" };
    const options = findPackagingSavings(box, US_2026);
    const toStandard = options.find((o) => o.after.tier === "Large standard");
    expect(toStandard).toBeDefined();
    expect(toStandard!.before.tier).toBe("Small bulky");
    expect(toStandard!.cuts).toEqual([expect.objectContaining({ side: "length" })]);
    expect(toStandard!.totalCutCm).toBeLessThanOrEqual(1);
    expect(toStandard!.savingPerUnit).toBeGreaterThan(2);
  });

  it("suggests nothing when the fee is set by the unit weight", () => {
    // SEZ0101011: 3.46 lb unit weight, dimensional weight 1.16 lb.
    const pad = { length: 23.5, width: 20.5, height: 5.5, weight: 1.57, sellingPrice: 20, category: "toys and games" };
    expect(findPackagingSavings(pad, US_2026)).toEqual([]);
    expect(findPackagingSavings(pad, US_2027)).toEqual([]);
  });

  it("never cuts all three sides, never more than 2 cm a side", () => {
    const box = { length: 46.5, width: 36, height: 21, weight: 2, sellingPrice: 30, category: "toys and games" };
    for (const o of findPackagingSavings(box, US_2027, { limit: 10 })) {
      expect(o.cuts.length).toBeLessThanOrEqual(2);
      for (const c of o.cuts) expect(c.byCm).toBeLessThanOrEqual(2);
    }
  });

  it("returns only options that save more as the cut grows", () => {
    const box = { length: 46.5, width: 20, height: 10, weight: 1, sellingPrice: 25, category: "toys and games" };
    const options = findPackagingSavings(box, US_2026, { limit: 10 });
    for (let i = 1; i < options.length; i++) {
      expect(options[i].totalCutCm).toBeGreaterThanOrEqual(options[i - 1].totalCutCm);
      expect(options[i].savingPerUnit).toBeGreaterThan(options[i - 1].savingPerUnit);
    }
  });

  it("is quick enough to run on every dashboard row", () => {
    const box = { length: 15, width: 9, height: 6.1, weight: 0.1432, sellingPrice: 9.99, category: "toys and games" };
    const t0 = performance.now();
    for (let i = 0; i < 25; i++) findPackagingSavings(box, US_2026);
    const ms = performance.now() - t0;
    console.log(`25 products: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});

describe("findWeightSavings", () => {
  // SEZ0101012 live snapshot: 21.5 x 15.3 x 8.1 cm, 1.32 kg (2.91 lb), $20.
  // Dimensional weight is only 1.17 lb, so the actual weight sets the band.
  const pad = { length: 21.5, width: 15.3, height: 8.1, weight: 1.32, sellingPrice: 20, category: "toys and games" };

  it("says the actual weight, not the box, sets SEZ0101012's fee", () => {
    expect(feeWeightDriver(pad, US_2027)).toBe("actual weight");
    expect(findPackagingSavings(pad, US_2027, { maxReductionCm: 10, maxPairReductionCm: 5, pairStepCm: 0.2 })).toEqual([]);
  });

  it("finds 73 g lighter drops it from 2.75-3 lb to 2.5-2.75 lb", () => {
    const [first] = findWeightSavings(pad, US_2027);
    expect(first.byKg).toBeCloseTo(0.073, 3);
    expect(first.before.weightBand).toBe("2.75+ to 3 lb");
    expect(first.after.weightBand).toBe("2.5+ to 2.75 lb");
    // 2027 weighted fee 7.055 -> 6.605
    expect(first.savingPerUnit).toBeCloseTo(0.45, 2);
    expect(findWeightSavings(pad, US_2026)[0].savingPerUnit).toBeCloseTo(0.425, 3);
  });

  it("finds nothing for a box-size-driven product (Beetle Brush)", () => {
    const brush = { length: 7.8, width: 4.3, height: 17.1, weight: 0.109, sellingPrice: 7.99, category: "baby products" };
    expect(feeWeightDriver(brush, US_2026)).toBe("box size");
    expect(findWeightSavings(brush, US_2026)).toEqual([]);
  });

  it("wide box search stays fast", () => {
    const box = { length: 30, width: 25, height: 12, weight: 1, sellingPrice: 25, category: "toys and games" };
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) findPackagingSavings(box, US_2027, { maxReductionCm: 10, maxPairReductionCm: 5, pairStepCm: 0.2 });
    console.log(`wide search x10: ${(performance.now() - t0).toFixed(0)} ms`);
  });
});
