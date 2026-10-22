import { describe, expect, it } from "vitest";
import type { InventoryMonthSummary, InventorySkuRow } from "./inventory";
import { aggregatePeriods, comparePeriods, likeForLike, pctChange, periodKey, ppChange, skuPeriodRows } from "./periods";
import { buildScorecard, matchScorecard } from "./scorecard";

/** A month with round numbers: everything scales with `k`. */
function month(m: string, k = 1, over: Partial<InventoryMonthSummary> = {}): InventoryMonthSummary {
  return {
    month: m, feesReady: true, salesMissing: false, source: "amazon",
    unitsSold: 1000 * k, unitsRefunded: 20 * k, grossSales: 21000 * k, refunds: 1000 * k, netSales: 20000 * k,
    fulfilmentFees: 4000 * k, referralFees: 3000 * k, otherOrderFees: 100 * k,
    fbaStorage: 300 * k, fbaStorageSource: "billed", agedSurcharge: 10 * k, awdStorage: 200 * k,
    awdProcessing: 50 * k, awdTransport: 40 * k, fbaInbound: 100 * k, removals: 0,
    supplyChainCost: 4700 * k, storageShareOfSales: null, supplyChainShareOfSales: null, fulfilmentPerUnit: 4,
    utilizationWeeks: 6, avgUnitsStored: null,
    fbaUnitsEnd: 5000, awdUnitsEnd: 5000, inventoryValue: 20000, cogsSold: 2000 * k, turnover: null,
    daysOfInventory: null, costCoverage: 1, awdUnattributed: 0, agedSurchargeBySku: null,
    unitsShipped: 1000 * k, unitsReceived: 800 * k, fbaUnitsAvg: 5000, awdUnitsAvg: 5000, heldValue: 20000,
    excessValue: 5000, deadValue: 0, inStockRate: 0.97, skusStockedOut: 1,
    ...over,
  };
}

describe("periodKey", () => {
  it("names quarters and years", () => {
    expect(periodKey("2026-08", "quarter")).toBe("2026-Q3");
    expect(periodKey("2026-08", "year")).toBe("2026");
  });
});

describe("aggregatePeriods", () => {
  const months = ["2025-07", "2025-08", "2025-09", "2026-07", "2026-08", "2026-09"].map((m) =>
    month(m, m.startsWith("2026") ? 2 : 1),
  );
  const ready = new Set(months.map((m) => m.month));

  it("sums flows and takes stock at the period end", () => {
    const q = aggregatePeriods(months, "quarter", ready).find((p) => p.key === "2026-Q3")!;
    expect(q.netSales).toBe(120000);
    expect(q.unitsSold).toBe(6000);
    expect(q.inventoryValue).toBe(20000);
    expect(q.supplyChainCost).toBe(2 * 3 * 4700);
  });

  it("recomputes KPIs from the sums", () => {
    const q = aggregatePeriods(months, "quarter", ready).find((p) => p.key === "2026-Q3")!;
    // 92 days; COGS 12,000 over average stock 20,000.
    expect(q.turnover).toBeCloseTo((12000 / 20000) * (365 / 92), 2);
    expect(q.storageShareOfSales).toBeCloseTo((6 * 300 + 6 * 200 + 6 * 10) / 120000, 4);
    // Contribution: 120,000 - 12,000 COGS - 18,000 referral - 600 other - 28,200 supply chain.
    expect(q.contributionMargin).toBe(61200);
    expect(q.landedCostPerUnit).toBeCloseTo(2 + 28200 / 6000, 2);
    expect(q.sellThrough).toBeCloseTo(6000 / (6000 + 10000), 4);
    expect(q.awdShare).toBe(0.5);
  });

  it("calls a period's flows unknown when any month is unread", () => {
    const partial = new Set([...ready].filter((m) => m !== "2026-08"));
    const q = aggregatePeriods(months, "quarter", partial).find((p) => p.key === "2026-Q3")!;
    expect(q.netSales).toBeNull();
    expect(q.feeMonths).toBe(2);
    // Stock and COGS come from the ledger, not the fee scan, so they stand.
    expect(q.cogsSold).toBe(12000);
  });

  it("marks a year that has not run twelve months", () => {
    const y = aggregatePeriods(months, "year", ready).find((p) => p.key === "2026")!;
    expect(y.toDate).toBe(true);
  });
});

describe("comparePeriods", () => {
  const months = ["2025-08", "2025-09", "2026-08", "2026-09"].map((m) => month(m, m.startsWith("2026") ? 2 : 1));
  const ready = new Set(months.map((m) => m.month));

  it("compares a month with the one before and with last year", () => {
    const periods = aggregatePeriods(months, "month", ready);
    const c = comparePeriods(periods, months, ready).get("2026-09")!;
    expect(c.prev?.key).toBe("2026-08");
    expect(c.yoy?.key).toBe("2025-09");
    expect(pctChange(periods.at(-1)!.netSales, c.yoy!.netSales)).toBe(1);
  });

  it("compares a year to date with the same months last year, not a whole year", () => {
    const periods = aggregatePeriods(months, "year", ready);
    const y = comparePeriods(periods, months, ready).get("2026")!;
    expect(y.yoy?.months).toEqual(["2025-08", "2025-09"]);
  });

  it("gives no comparison when the base months are missing", () => {
    const periods = aggregatePeriods(months, "month", ready);
    expect(comparePeriods(periods, months, ready).get("2025-08")!.yoy).toBeNull();
  });

  it("states shares as point changes", () => {
    expect(ppChange(0.31, 0.3)).toBeCloseTo(0.01, 6);
  });
});

describe("skuPeriodRows", () => {
  const row = (month: string, units: number, sales: number, held: number): InventorySkuRow =>
    ({
      month, sku: "A1", asin: "B1", productName: "P", unitsSold: units, unitsRefunded: 0, netSales: sales,
      fulfilmentFees: units * 4, fulfilmentPerUnit: 4, referralFees: 0, fbaStorage: 10, avgUnitsStored: null,
      storagePerUnitSold: null, storageShareOfSales: null, costShareOfSales: null,
      fbaUnitsEnd: held, awdUnitsEnd: 0, avgUnitsHeld: held, fbaUnitsAvg: held, awdUnitsAvg: 0,
      unitsShipped: units, unitsReceived: 0, unitCost: 2, costSource: "landed", inventoryValue: held * 2,
      cogsSold: units * 2, turnover: null, daysOfInventory: null, awdProcessing: 1, awdTransport: 1,
      awdStorage: 3, agedSurcharge: null, agedUnits: null,
    }) as InventorySkuRow;

  it("sums a SKU over the period and compares it with the base", () => {
    const rows = [row("2026-08", 100, 2000, 500), row("2026-09", 300, 6000, 400), row("2026-07", 100, 2000, 600)];
    const [r] = skuPeriodRows(rows, ["2026-08", "2026-09"], ["2026-07"]);
    expect(r.unitsSold).toBe(400);
    expect(r.fbaUnitsEnd).toBe(400);
    expect(r.awdCost).toBe(10);
    expect(r.netSalesChange).toBe(3);
  });
});

describe("like-for-like on fewer months", () => {
  // Q3 2026 has no September AWD bill yet; Q3 2025 has no ledger for July.
  const months = [
    month("2025-07", 1, { inStockRate: null }),
    month("2025-08", 1, { inStockRate: 0.9 }),
    month("2025-09", 1, { inStockRate: 0.9 }),
    month("2026-07", 2, { inStockRate: 0.99 }),
    month("2026-08", 2, { inStockRate: 0.99 }),
    month("2026-09", 2, { awdStorage: null, inStockRate: 0.99 }),
  ];
  const ready = new Set(months.map((m) => m.month));
  const q = aggregatePeriods(months, "quarter", ready);
  const cur = q.find((p) => p.key === "2026-Q3")!;
  const base = comparePeriods(q, months, ready).get("2026-Q3")!.yoy!;

  it("compares a measure on the months both sides have it", () => {
    expect(cur.storageShareOfSales).toBeNull();
    const r = likeForLike(cur, base, months, ready, (s) => s.storageShareOfSales)!;
    expect(r.months).toEqual(["2026-07", "2026-08"]);
    expect(r.baseMonths).toEqual(["2025-07", "2025-08"]);
    expect(r.current).toBeCloseTo(510 / 20000, 4);
  });

  it("drops the base's missing months from both sides", () => {
    const r = likeForLike(cur, base, months, ready, (s) => s.inStockRate)!;
    expect(r.months).toEqual(["2026-08", "2026-09"]);
    expect(r.base).toBeCloseTo(0.9, 4);
  });

  it("leaves a measure alone when every month has it", () => {
    expect(likeForLike(cur, base, months, ready, (s) => s.fulfilmentPerUnit)).toBeNull();
  });

  it("feeds the scorecard, which says which months it used", () => {
    const card = buildScorecard(cur, base, matchScorecard(cur, base, months, ready));
    const row = card.rows.find((r) => r.measure.key === "inStockRate")!;
    expect(row.verdict).toBe("improving");
    expect(row.months).toEqual(["2026-08", "2026-09"]);
  });
});
