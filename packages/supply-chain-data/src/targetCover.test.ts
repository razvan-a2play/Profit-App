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

  it("caps the ideal for a sliver when nothing prices a cubic foot that month", () => {
    const r = storageVsTarget([row("2026-06", { unitsShipped: 3000, avgUnitsHeld: 5, fbaStorage: 1, awdStorage: 0 })]);
    expect(r.rows[0].idealStorage).toBe(MAX_SCALE);
    expect(r.rows[0].capped).toBe(true);
  });

  it("scales a big seller running thin at its own price, uncapped", () => {
    // 1,000 held at $0.05 a unit; 60 days of 100 a day is 6,000 units, six times as many.
    const r = storageVsTarget([row("2026-06", { unitsShipped: 3000, avgUnitsHeld: 1000, fbaStorage: 50, awdStorage: 0 })], 60, "fba");
    expect(r.rows[0].idealStorage).toBeCloseTo(300, 0);
    expect(r.rows[0].capped).toBe(false);
  });

  it("prices a sliver at its cu ft × the month's rate per cu ft", () => {
    // OTHER sets the rate: 1,000 units × 0.1 cu ft = 100 cu ft for $78, $0.78 a cu ft.
    const r = storageVsTarget(
      [
        row("2026-06", { sku: "OTHER", unitsShipped: 300, avgUnitsHeld: 1000, fbaStorage: 78, cuftPerUnit: 0.1 }),
        row("2026-06", { sku: "THIN", unitsShipped: 300, avgUnitsHeld: 5, fbaStorage: 1, cuftPerUnit: 0.2 }),
      ],
      60,
      "fba",
    );
    const thin = r.rows.find((x) => x.sku === "THIN")!;
    expect(thin.idealStorage).toBeCloseTo(thin.targetUnits * 0.2 * 0.78, 1);
    expect(thin.capped).toBe(false);
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

  it("prices the target as its cubic feet at the rate Amazon charged", () => {
    // 1,200 units × 0.1 cu ft = 120 cu ft billed $93.60, so $0.78 a cu ft.
    const r = storageVsTarget(
      ["2026-06", "2026-07", "2026-08"].map((m) => row(m, { unitsShipped: 310, avgUnitsHeld: 1200, fbaStorage: 93.6, cuftPerUnit: 0.1 })),
      60,
      "fba",
    );
    const june = r.rows.find((x) => x.month === "2026-06")!;
    expect(june.cuftHeld).toBe(120);
    expect(june.ratePerCuft).toBe(0.78);
    expect(june.cuftTarget).toBeCloseTo(june.targetUnits * 0.1, 0);
    expect(june.idealStorage).toBeCloseTo(june.cuftTarget! * 0.78, 0);
    expect(r.months[0].cuftHeld).toBe(120);
  });

  it("marks months whose aged report is unread, and keeps excess without aged apart", () => {
    const mk = (aged: number | null) =>
      ["2026-06", "2026-07", "2026-08"].map((m) => row(m, { unitsShipped: 310, avgUnitsHeld: 1200, fbaStorage: 30, agedSurcharge: aged }));
    const unread = storageVsTarget(mk(null), 60, "fba").months[0];
    const read = storageVsTarget(mk(5), 60, "fba").months[0];
    expect(unread.agedKnown).toBe(false);
    expect(read.agedKnown).toBe(true);
    expect(read.overstockCost - read.overstockStorage).toBeCloseTo(5, 2);
    expect(unread.overstockStorage).toBeCloseTo(read.overstockStorage, 2);
  });

  it("uses the account's aged total where the per-SKU report doesn't reach", () => {
    const rows = ["2026-06", "2026-07", "2026-08"].map((m) => row(m, { unitsShipped: 310, avgUnitsHeld: 1200, fbaStorage: 30, agedSurcharge: null }));
    const bare = storageVsTarget(rows, 60, "fba").months[0];
    const filled = storageVsTarget(rows, 60, "fba", { "2026-06": 40 }).months[0];
    expect(filled.agedSource).toBe("account");
    expect(filled.agedSurcharge).toBe(40);
    expect(filled.overstockCost).toBeCloseTo(bare.overstockCost + 40, 2);
    expect(storageVsTarget(rows, 60, "awd", { "2026-06": 40 }).months[0]?.agedSurcharge ?? 0).toBe(0);
  });
});

describe("seasonal SKUs", () => {
  // Quiet in February, peak in May-June: the build has to be in hand by spring.
  const shipped: Record<string, number> = { "2026-02": 280, "2026-03": 310, "2026-04": 600, "2026-05": 3100, "2026-06": 6000, "2026-07": 3100 };
  const rows = Object.entries(shipped).map(([m, u]) =>
    row(m, { sku: "POOL", unitsShipped: u, avgUnitsHeld: 3000, fbaStorage: 30, awdStorage: 60, fbaUnitsAvg: 500, avgUnitsStored: 500, awdUnitsAvg: 2500 }),
  );

  it("treats a pre-season build up to lead time + target days ahead as on target", () => {
    const plain = storageVsTarget(rows, 60, "awd").rows.find((r) => r.month === "2026-02")!;
    const seasonal = storageVsTarget(rows, 60, "awd", {}, { POOL: 90 }).rows.find((r) => r.month === "2026-02")!;
    // 150 days from mid-February: 14 days of Feb, all of Mar, Apr, May and Jun (136 days), then 14 of Jul.
    expect(seasonal.seasonalUnits).toBe(Math.round(140 + 310 + 600 + 3100 + 6000 + (3100 * 14) / 31));
    expect(seasonal.seasonalLeadDays).toBe(90);
    // 2,500 at AWD is above the plain target (excess there) but inside the season's band.
    expect(plain.excessCost).toBeGreaterThan(0);
    expect(seasonal.targetUnits).toBe(2500);
    expect(seasonal.excessCost).toBeCloseTo(0, 2);
  });

  it("still counts stock above the season's needs as excess", () => {
    const heavy = rows.map((r) => (r.month === "2026-02" ? { ...r, awdUnitsAvg: 20000, awdStorage: 480 } : r));
    const feb = storageVsTarget(heavy, 60, "awd", {}, { POOL: 90 }).rows.find((r) => r.month === "2026-02")!;
    expect(feb.targetUnits).toBe(feb.seasonalUnits);
    expect(feb.excessCost).toBeGreaterThan(0);
  });

  it("doesn't turn a thin build into a saving: lean is judged on the plain target", () => {
    const thin = rows.map((r) => (r.month === "2026-02" ? { ...r, awdUnitsAvg: 150, awdStorage: 3.6 } : r));
    const plain = storageVsTarget(thin, 60, "awd").rows.find((r) => r.month === "2026-02")!;
    const seasonal = storageVsTarget(thin, 60, "awd", {}, { POOL: 90 }).rows.find((r) => r.month === "2026-02")!;
    expect(seasonal.targetUnits).toBe(plain.targetUnits);
    expect(seasonal.excessCost).toBeCloseTo(plain.excessCost, 2);
  });

  it("keeps FBA on the plain target: AWD refills it within weeks", () => {
    const fba = storageVsTarget(rows, 60, "fba", {}, { POOL: 90 }).rows.find((r) => r.month === "2026-02")!;
    expect(fba.seasonalLeadDays).toBeNull();
  });

  it("falls back to the plain target where the season ahead isn't read yet", () => {
    const last = storageVsTarget(rows, 60, "awd", {}, { POOL: 90 }).rows.find((r) => r.month === "2026-06")!;
    expect(last.seasonalLeadDays).toBeNull();
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
