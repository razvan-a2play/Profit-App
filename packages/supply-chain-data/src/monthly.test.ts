import { describe, expect, it } from "vitest";
import { buildMonthlyReport, monthRange, storageMonthOf, type MonthCostsInput } from "./monthly";
import type { BilledCharge, BilledFees, SkuMonthSales, StorageSkuRow } from "./storageCosts";

const charge = (fee_type: string, group: BilledCharge["group"], amount: number, reference = ""): BilledCharge => ({
  fee_type,
  description: fee_type,
  group,
  amount,
  currency: "USD",
  reference,
  posted_date: null,
});

const billed = (charges: BilledCharge[], by_sku?: Record<string, SkuMonthSales>): BilledFees => {
  const by_group: BilledFees["by_group"] = {};
  for (const c of charges) by_group[c.group] = (by_group[c.group] ?? 0) + c.amount;
  return { ready: true, pages: 1, total: 0, by_group, by_type: [], unrecognised_fee_types: [], charges, by_sku };
};

const sales = (units: number, gross: number, fulfilment: number, refunds = 0): SkuMonthSales => ({
  units_sold: units,
  units_refunded: 0,
  sales: gross,
  refunds,
  fees: { FBAPerUnitFulfillmentFee: fulfilment, Commission: gross * 0.15 },
});

const storageRow = (asin: string, fee: number, units: number): StorageSkuRow =>
  ({ asin, product_name: `P ${asin}`, fee, avg_units: units }) as StorageSkuRow;

const storageResult = (rows: StorageSkuRow[], weeks = 6.2) => ({
  ready: true,
  rows,
  totals: {
    fee: rows.reduce((a, r) => a + r.fee, 0),
    utilization_ratio_weeks: weeks,
  } as never,
});

describe("storageMonthOf", () => {
  it("reads the month AWD names in its reference", () => {
    expect(storageMonthOf(charge("STARStorageFee", "awd_storage", 1, "US-2026-08-A25DETU405FE64"), "2026-09")).toBe(
      "2026-08",
    );
  });
  it("puts unreferenced FBA storage in the month before it posted", () => {
    expect(storageMonthOf(charge("FBAStorageFee", "fba_storage", 1), "2026-01")).toBe("2025-12");
  });
});

describe("monthRange", () => {
  it("counts back across a year end", () => {
    expect(monthRange("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("buildMonthlyReport", () => {
  const aug: MonthCostsInput = {
    billed: billed(
      [
        charge("FBAStorageFee", "fba_storage", 900), // July's storage
        charge("AmazonUpstreamProcessingFee", "awd_receiving", 50, "IB_2026-08-03_STAR-X"),
        charge("AmazonUpstreamStorageTransportationFee", "awd_transportation", 120, "repl-1"),
        charge("FBALongTermStorageFee", "fba_storage", 30), // August's aged surcharge, assessed mid-month
      ],
      { a1: sales(100, 2000, 600), B2: sales(10, 500, 80, 50) },
    ),
    storage: storageResult([storageRow("ASIN1", 100, 5000), storageRow("ASIN2", 40, 900)]),
  };
  const sep: MonthCostsInput = {
    billed: billed(
      [
        charge("FBAStorageFee", "fba_storage", 1000), // August's storage
        charge("FBALongTermStorageFee", "fba_storage", 45), // September's: not August's
        charge("STARStorageFee", "awd_storage", 400, "US-2026-08-A25DETU405FE64"),
      ],
      {},
    ),
    storage: null,
  };

  const report = buildMonthlyReport({
    months: ["2026-08"],
    costsByMonth: { "2026-08": aug, "2026-09": sep },
    asinBySku: { A1: "asin1", B2: "ASIN2" },
  });
  const m = report.months[0];

  // Storage is billed a month in arrears; the aged surcharge posts in the month
  // it was assessed (Amazon's per-SKU aged report for a month matches it).
  it("takes a month's storage from the invoice posted the month after", () => {
    expect(m.fbaStorage).toBe(1000);
    expect(m.fbaStorageSource).toBe("billed");
    expect(m.agedSurcharge).toBe(30);
    expect(m.awdStorage).toBe(400);
  });

  it("keeps activity charges in the month they posted", () => {
    expect(m.awdProcessing).toBe(50);
    expect(m.awdTransport).toBe(120);
  });

  it("nets refunds off sales and states storage as a share of them", () => {
    expect(m.netSales).toBe(2450);
    expect(m.fulfilmentFees).toBe(680);
    expect(m.storageShareOfSales).toBeCloseTo((1000 + 30 + 400) / 2450, 4);
    expect(m.supplyChainCost).toBe(680 + 1000 + 30 + 400 + 50 + 120);
    expect(m.utilizationWeeks).toBe(6.2);
  });

  it("ties per-ASIN storage to SKUs case-insensitively", () => {
    const a1 = report.skus.find((r) => r.sku === "A1")!;
    expect(a1.fbaStorage).toBe(100);
    expect(a1.fulfilmentPerUnit).toBe(6);
    expect(a1.storagePerUnitSold).toBe(1);
    expect(a1.storageShareOfSales).toBe(0.05);
  });

  it("falls back to the storage report while the invoice has not posted", () => {
    const r = buildMonthlyReport({ months: ["2026-08"], costsByMonth: { "2026-08": aug }, asinBySku: {} });
    expect(r.months[0].fbaStorage).toBe(140);
    expect(r.months[0].fbaStorageSource).toBe("estimate");
    // AWD storage is unknown, so no share is claimed.
    expect(r.months[0].awdStorage).toBeNull();
    expect(r.months[0].storageShareOfSales).toBeNull();
  });

  it("splits a shared ASIN's storage by units sold", () => {
    const r = buildMonthlyReport({
      months: ["2026-08"],
      costsByMonth: {
        "2026-08": {
          billed: billed([], { X: sales(30, 300, 90), Y: sales(10, 100, 30) }),
          storage: storageResult([storageRow("ASINX", 80, 400)]),
        },
      },
      asinBySku: { X: "ASINX", Y: "ASINX" },
    });
    expect(r.skus.find((s) => s.sku === "X")!.fbaStorage).toBe(60);
    expect(r.skus.find((s) => s.sku === "Y")!.fbaStorage).toBe(20);
  });

  it("calls sales unknown, not zero, when the scan predates per-SKU sales", () => {
    const r = buildMonthlyReport({
      months: ["2026-08"],
      costsByMonth: { "2026-08": { billed: billed([]), storage: null } },
      asinBySku: {},
    });
    expect(r.months[0].salesMissing).toBe(true);
    expect(r.months[0].storageShareOfSales).toBeNull();
  });
});

describe("account-level months", () => {
  it("counts an account-level month in the totals without listing it as a product", async () => {
    const { ACCOUNT_LEVEL_SKU } = await import("./storageCosts");
    const r = buildMonthlyReport({
      months: ["2024-06"],
      costsByMonth: {
        "2024-06": {
          billed: { ...billed([], { [ACCOUNT_LEVEL_SKU]: sales(500, 10000, 2000) }), storageKnown: false, source: "helium" },
          storage: null,
        },
      },
      asinBySku: {},
    });
    expect(r.months[0].netSales).toBe(10000);
    expect(r.months[0].source).toBe("helium");
    expect(r.skus).toHaveLength(0);
  });

  it("leaves storage unknown when the invoicing month's storage can't be trusted", () => {
    const r = buildMonthlyReport({
      months: ["2024-06"],
      costsByMonth: {
        "2024-06": { billed: billed([], {}), storage: null },
        "2024-07": { billed: { ...billed([]), storageKnown: false }, storage: null },
      },
      asinBySku: {},
    });
    expect(r.months[0].fbaStorage).toBeNull();
    expect(r.months[0].awdStorage).toBeNull();
  });
});

describe("signed charges", () => {
  it("nets a storage refund against the charge it reverses", () => {
    const r = buildMonthlyReport({
      months: ["2026-07"],
      costsByMonth: {
        "2026-07": { billed: billed([], {}), storage: null },
        "2026-08": {
          billed: {
            ...billed([
              charge("FBAStorageFee", "fba_storage", 1745.92),
              charge("FBAStorageFee", "fba_storage", 141.6),
              charge("FBAStorageFee", "fba_storage", -141.6),
            ]),
            signed: true,
          },
          storage: null,
        },
      },
      asinBySku: {},
    });
    expect(r.months[0].fbaStorage).toBe(1745.92);
  });
});
