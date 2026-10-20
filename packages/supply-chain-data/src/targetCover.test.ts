import { describe, expect, it } from "vitest";
import type { InventorySkuRow } from "./inventory";
import { awdStorageEffect } from "./monthly";
import { demandRate, MAX_SCALE, storageVsTarget } from "./targetCover";

const row = (month: string, over: Partial<InventorySkuRow>): InventorySkuRow =>
  ({
    month, sku: "A1", asin: "B1", productName: "P", unitsSold: 0, unitsShipped: 0, avgUnitsHeld: 0,
    fbaStorage: null, awdStorage: null, agedSurcharge: null, cuftPerUnit: 0.05,
    // Unless a test says otherwise, all stock is FBA stock Amazon billed storage on.
    avgUnitsStored: over.avgUnitsHeld ?? 0, awdUnitsAvg: 0,
    ...over,
  }) as InventorySkuRow;

describe("demandRate", () => {
  const shipped = new Map([["2026-06", 300], ["2026-07", 310], ["2026-08", 620]]);

  it("centres on the 60 days after mid-month when the future is known", () => {
    const d = demandRate(shipped, "2026-06", new Set(["2026-06", "2026-07", "2026-08"]))!;
    // 150 + 310 + 310 units over 15 + 31 + 15.5 days.
    expect(d.basis).toBe("forward");
    expect(d.rate).toBeCloseTo(770 / 61.5, 6);
  });

  it("falls back to the trailing rate for the latest months", () => {
    const d = demandRate(shipped, "2026-08", new Set(["2026-06", "2026-07", "2026-08"]))!;
    expect(d.basis).toBe("trailing");
    expect(d.rate).toBeCloseTo((310 + 620) / 62, 6);
  });
});

describe("storageVsTarget", () => {
  // Steady 10 units a day across June–August.
  const steady = (month: string, held: number, storage: number, aged = 0) =>
    row(month, { unitsShipped: 10 * (month === "2026-06" ? 30 : 31), avgUnitsHeld: held, fbaStorage: storage, awdStorage: 0, agedSurcharge: aged });

  it("charges the excess above 60 days, and the whole aged surcharge, as loss", () => {
    const r = storageVsTarget([steady("2026-06", 1200, 120, 15), steady("2026-07", 600, 60), steady("2026-08", 600, 60)]);
    const june = r.rows.find((x) => x.month === "2026-06")!;
    // ~10.2/day forward demand -> ~610 units target; held 1,200.
    expect(june.coverDays).toBeGreaterThan(110);
    expect(june.idealStorage).toBeCloseTo(120 * (june.targetUnits / 1200), 0);
    expect(june.excessCost).toBeCloseTo(120 + 15 - june.idealStorage, 1);
    expect(r.months[0].overstockCost).toBeGreaterThan(60);
  });

  it("keeps savings from running lean apart from overspend", () => {
    const r = storageVsTarget([steady("2026-06", 300, 30), steady("2026-07", 600, 60), steady("2026-08", 600, 60)]);
    const m = r.months.find((x) => x.month === "2026-06")!;
    expect(m.overstockCost).toBe(0);
    expect(m.leanSaving).toBeGreaterThan(25);
    expect(m.net).toBe(-m.leanSaving);
  });

  it("counts all storage on stock that sold nothing as loss", () => {
    const r = storageVsTarget([row("2026-06", { unitsShipped: 0, avgUnitsHeld: 500, fbaStorage: 40, awdStorage: 10 })]);
    expect(r.rows[0].idealStorage).toBe(0);
    expect(r.rows[0].excessCost).toBe(50);
    expect(r.rows[0].coverDays).toBeNull();
  });

  it("caps the ideal for a SKU holding a sliver of its target", () => {
    const r = storageVsTarget([row("2026-06", { unitsShipped: 3000, avgUnitsHeld: 5, fbaStorage: 1, awdStorage: 0 })]);
    expect(r.rows[0].idealStorage).toBe(MAX_SCALE);
  });

  it("only judges months with Amazon's per-SKU storage", () => {
    expect(storageVsTarget([row("2026-06", { unitsShipped: 100, avgUnitsHeld: 500, fbaStorage: null })]).rows).toHaveLength(0);
  });
});

describe("awdStorageEffect", () => {
  const c = (fee_type: string, group = "other") =>
    ({ fee_type, group, amount: 100, description: "", currency: "USD", reference: "", posted_date: null }) as never;
  it("reads AWD storage reversals as refunds and corrections as charges", () => {
    expect(awdStorageEffect(c("STARStorageFee", "awd_storage"))).toBe(100);
    expect(awdStorageEffect(c("STARStorageFee-Reversal"))).toBe(-100);
    expect(awdStorageEffect(c("STARStorageFee-Correction"))).toBe(100);
    expect(awdStorageEffect(c("FBAStorageFee", "fba_storage"))).toBeNull();
  });

  it("trusts the amount's own sign once charges are signed", () => {
    const refund = { ...(c("STARStorageFee-Reversal") as object), amount: -100 } as never;
    expect(awdStorageEffect(refund, true)).toBe(-100);
    expect(awdStorageEffect(c("STARStorageFee-Correction"), true)).toBe(100);
  });
});

describe("price per unit", () => {
  it("charges a bulkier SKU more per excess unit", () => {
    // Same stock and demand; one unit takes four times the space, so Amazon billed four times as much.
    const mk = (sku: string, cuft: number, fee: number) =>
      ["2026-06", "2026-07", "2026-08"].map((m) =>
        row(m, { sku, unitsShipped: 310, avgUnitsHeld: 1200, fbaStorage: fee, cuftPerUnit: cuft }),
      );
    const r = storageVsTarget([...mk("SMALL", 0.05, 30), ...mk("BULKY", 0.2, 120)], 60, "fba");
    const small = r.rows.find((x) => x.sku === "SMALL" && x.month === "2026-06")!;
    const bulky = r.rows.find((x) => x.sku === "BULKY" && x.month === "2026-06")!;
    expect(bulky.pricePerUnitMonth).toBeCloseTo(4 * small.pricePerUnitMonth!, 6);
    expect(bulky.excessCost).toBeCloseTo(4 * small.excessCost, 1);
    expect(bulky.cuftPerUnit).toBe(0.2);
  });
});

describe("per channel", () => {
  // 10 units a day; FBA holds 300 (30 days), AWD 1,500 (150 days).
  const r = (month: string) =>
    row(month, {
      unitsShipped: month === "2026-06" ? 300 : 310,
      avgUnitsHeld: 1800, fbaUnitsAvg: 300, avgUnitsStored: 300, awdUnitsAvg: 1500,
      fbaStorage: 30, awdStorage: 45, agedSurcharge: 5,
    });
  const rows = [r("2026-06"), r("2026-07"), r("2026-08")];

  it("judges FBA on FBA stock and FBA storage, with the aged surcharge", () => {
    const june = storageVsTarget(rows, 30, "fba").rows.find((x) => x.month === "2026-06")!;
    expect(june.unitsHeld).toBe(300);
    expect(june.actualStorage).toBe(30);
    expect(june.agedSurcharge).toBe(5);
    // Forward demand: (150 + 310 + 155) units over 61.5 days = 10 a day.
    expect(june.coverDays).toBe(30);
  });

  it("judges AWD on AWD stock and AWD storage only", () => {
    const report = storageVsTarget(rows, 60, "awd");
    const june = report.rows.find((x) => x.month === "2026-06")!;
    expect(report.channel).toBe("awd");
    expect(june.unitsHeld).toBe(1500);
    expect(june.actualStorage).toBe(45);
    expect(june.agedSurcharge).toBe(0);
    // ~10.2/day x 60 = ~610 target against 1,500 held: most of the AWD bill is excess.
    expect(june.excessCost).toBeGreaterThan(25);
  });

  it("leaves AWD out until its storage is invoiced", () => {
    expect(storageVsTarget([row("2026-09", { unitsShipped: 300, awdUnitsAvg: 900, awdStorage: null, fbaStorage: 10 })], 60, "awd").rows).toHaveLength(0);
  });
});
