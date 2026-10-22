import { describe, expect, it } from "vitest";
import type { InventoryMonthSummary, InventorySkuRow } from "./inventory";
import { classifySkus, monthsForSkus } from "./segments";

const row = (month: string, sku: string, over: Partial<InventorySkuRow> = {}): InventorySkuRow =>
  ({
    month, sku, asin: sku, productName: sku, unitsSold: 10, unitsRefunded: 0, netSales: 100,
    fulfilmentFees: 40, fulfilmentPerUnit: 4, referralFees: 15, fbaStorage: 5, avgUnitsStored: 50, cuftPerUnit: 0.1,
    storagePerUnitSold: null, storageShareOfSales: null, costShareOfSales: null,
    fbaUnitsEnd: 50, awdUnitsEnd: 0, avgUnitsHeld: 50, fbaUnitsAvg: 50, awdUnitsAvg: 0, unitsShipped: 10, unitsReceived: 10,
    unitCost: 2, costSource: "landed", inventoryValue: 100, cogsSold: 20, turnover: null, daysOfInventory: null,
    awdProcessing: 0, awdTransport: 0, awdStorage: 2, agedSurcharge: 0, agedUnits: 0,
    excessStock: false, inStockShare: 1, inStockWeight: 10,
    ...over,
  }) as InventorySkuRow;

const year = (sku: string, sales: number, over: Partial<InventorySkuRow> = {}) =>
  Array.from({ length: 12 }, (_, i) => row(`2026-${String(i + 1).padStart(2, "0")}`, sku, { netSales: sales / 12, ...over }));

describe("classifySkus", () => {
  // 100 units of sales: 60 + 25 = 85 reaches past 80%, so both are A; 10 more is B up to 95; the rest C.
  const rows = [
    ...year("BIG", 60_000), ...year("SECOND", 25_000), ...year("MID", 10_000), ...year("TAIL1", 3_000), ...year("TAIL2", 2_000),
    // Older history so a first sale in the window isn't the data's first month.
    row("2025-12", "BIG"),
    // Launched in August: new, however well it sells.
    ...["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"].map((m) => row(m, "LAUNCH", { netSales: 50_000 })),
    // Stock, but no sale since July.
    ...year("STUCK", 1_200).map((r) => (r.month > "2026-07" ? { ...r, unitsSold: 0, netSales: 0 } : r)),
  ];
  const c = classifySkus(rows, "2026-12");

  it("ranks the A/B/C pool by twelve months' net sales", () => {
    expect(c.BIG.cls).toBe("A");
    expect(c.SECOND.cls).toBe("A");
    expect(c.MID.cls).toBe("B");
    expect(c.TAIL1.cls).toBe("C");
    expect(c.TAIL2.cls).toBe("C");
    // Shares are of the A/B/C pool: the dormant SKU's sales don't count.
    expect(c.BIG.cumShare).toBeCloseTo(0.6, 3);
  });

  it("keeps launches and stuck stock out of the ranking", () => {
    expect(c.LAUNCH.cls).toBe("new");
    expect(c.STUCK.cls).toBe("dormant");
    expect(c.LAUNCH.share).toBeNull();
  });
});

describe("monthsForSkus", () => {
  const acct = {
    month: "2026-06", feesReady: true, salesMissing: false, source: "amazon",
    unitsSold: 20, unitsRefunded: 0, grossSales: 220, refunds: 20, netSales: 200, fulfilmentFees: 80, referralFees: 30,
    otherOrderFees: 10, fbaStorage: 10, fbaStorageSource: "billed", agedSurcharge: 0, awdStorage: 4, awdProcessing: 0,
    awdTransport: 0, fbaInbound: 8, removals: 6, supplyChainCost: 108, storageShareOfSales: null, supplyChainShareOfSales: null,
    fulfilmentPerUnit: 4, utilizationWeeks: 7, avgUnitsStored: 100,
  } as unknown as InventoryMonthSummary;
  const rows = [row("2026-06", "A1"), row("2026-06", "C1", { unitsReceived: 30, inStockShare: 0.5, inStockWeight: 30 })];

  it("rebuilds the totals from the kept SKUs and shares out account-only fees", () => {
    const [m] = monthsForSkus([acct], rows, new Set(["A1"]));
    expect(m.netSales).toBe(100);
    expect(m.fbaStorage).toBe(5);
    expect(m.otherOrderFees).toBe(5); // half the sales
    expect(m.fbaInbound).toBe(2); // 10 of 40 units received
    expect(m.utilizationWeeks).toBeNull();
    expect(m.inStockRate).toBe(1);
  });

  it("weights in-stock by each SKU's pace", () => {
    const [m] = monthsForSkus([acct], rows, new Set(["A1", "C1"]));
    expect(m.inStockRate).toBeCloseTo((10 * 1 + 30 * 0.5) / 40, 4);
  });
});

describe("aged surcharge before the per-SKU report", () => {
  it("shares the account's surcharge by FBA storage cost", () => {
    const acct = { month: "2025-06", netSales: 200, agedSurcharge: 30, fbaStorage: 10, awdStorage: 4, fbaInbound: 0, removals: 0, otherOrderFees: 0, grossSales: 200, refunds: 0 } as unknown as InventoryMonthSummary;
    const rows = [row("2025-06", "A1", { agedSurcharge: null, fbaStorage: 6 }), row("2025-06", "C1", { agedSurcharge: null, fbaStorage: 2 })];
    const [m] = monthsForSkus([acct], rows, new Set(["A1"]));
    expect(m.agedSurcharge).toBeCloseTo(22.5, 4);
  });
});
