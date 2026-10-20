import { describe, expect, it } from "vitest";
import { assessSupplyChain, type AwdStockRow } from "./supplyChain";
import type { BilledFees, PlanningRow, StorageSkuRow } from "./storageCosts";

const storage = (asin: string, fee: number, units: number): StorageSkuRow => ({
  asin,
  fnsku: asin,
  product_name: `Product ${asin}`,
  month: "2026-08",
  country: "US",
  currency: "USD",
  size_tier: "Standard-Size",
  item_volume_cuft: 0.06,
  utilization_ratio_weeks: 6.2,
  base_rate: 0.78,
  surcharge_rate: 0,
  avg_units: units,
  total_volume_cuft: units * 0.06,
  base_fee: fee,
  surcharge_fee: 0,
  fee,
  incentive_discount: 0,
  fee_per_unit: units ? fee / units : null,
  fulfillment_centers: 10,
  volume_units: "cubic feet",
});

const plan = (sku: string, asin: string, t90: number, cover: number | null): PlanningRow => ({
  sku,
  asin,
  sell_through: 1.2,
  days_of_supply: cover,
  item_volume_cuft: 0.06,
  units_shipped_t90: t90,
});

const awd = (sku: string, available: number): AwdStockRow => ({
  sku,
  available,
  inbound: 0,
  reserved: 0,
  toFba: 0,
});

const billed = (awdStorage: number, handling: number): BilledFees => ({
  ready: true,
  pages: 1,
  total: awdStorage + handling,
  by_group: { awd_storage: awdStorage, awd_receiving: handling },
  by_type: [],
  unrecognised_fee_types: [],
  charges: [],
});

describe("assessSupplyChain", () => {
  const base = {
    month: "2026-08",
    storageRows: [storage("B01", 300, 10000), storage("B02", 50, 400), storage("B03", 120, 5000)],
    planning: [plan("FAST", "B01", 12000, 60), plan("THIN", "B02", 9000, 9), plan("DEAD", "B03", 0, null)],
    awdStock: [awd("FAST", 5000), awd("DEAD", 5000)],
    billed: billed(1000, 200),
    asinBySku: { FAST: "B01", THIN: "B02", DEAD: "B03" },
    priceBySku: { FAST: 20, THIN: 10, DEAD: 15 },
    utilizationWeeks: 6.2,
  };

  it("keeps the billed storage separate from the allocated AWD share", () => {
    const r = assessSupplyChain(base);
    // FBA storage is billed per ASIN and must survive untouched.
    expect(r.measuredTotal).toBe(470);
    // AWD is billed to the account: $1,200 shared over 10,000 AWD units.
    expect(r.allocatedTotal).toBeCloseTo(1200, 2);
    const fast = r.skus.find((s) => s.sku === "FAST")!;
    expect(fast.fbaStorage).toBe(300);
    expect(fast.awdStorageAllocated).toBeCloseTo(500, 2); // half the AWD units
  });

  it("calls a SKU that sold nothing while holding stock dead", () => {
    const dead = assessSupplyChain(base).skus.find((s) => s.sku === "DEAD")!;
    expect(dead.verdict).toBe("dead_stock");
    expect(dead.reasons.join(" ")).toMatch(/No units shipped in 90 days/);
  });

  it("flags thin cover as exposed to the low-inventory fee", () => {
    const thin = assessSupplyChain(base).skus.find((s) => s.sku === "THIN")!;
    expect(thin.verdict).toBe("stockout_risk");
    expect(thin.reasons.join(" ")).toMatch(/low-inventory-level fee/);
  });

  it("flags overstock by days of cover, not by stock size", () => {
    // A big SKU that turns fast is healthy; a small one that doesn't is not.
    const r = assessSupplyChain({
      ...base,
      planning: [plan("FAST", "B01", 12000, 365), plan("THIN", "B02", 9000, 40), plan("DEAD", "B03", 10, 90)],
    });
    expect(r.skus.find((s) => s.sku === "FAST")!.verdict).toBe("overstocked");
    expect(r.skus.find((s) => s.sku === "THIN")!.verdict).toBe("healthy");
  });

  it("measures cost against what the SKU earns, not against other SKUs", () => {
    // DEAD: $120 FBA + half of $1,200 AWD = $720 on 10 units/month at $15.
    const r = assessSupplyChain({
      ...base,
      planning: [plan("FAST", "B01", 12000, 60), plan("THIN", "B02", 9000, 40), plan("DEAD", "B03", 30, 90)],
    });
    const dead = r.skus.find((s) => s.sku === "DEAD")!;
    expect(dead.costShareOfRevenue).toBeGreaterThan(1); // costs more than it sells
    expect(dead.verdict).toBe("storage_heavy");
  });

  it("will not call a SKU dead when its sales data is simply missing", () => {
    // The planning report failing to load must not read as "sold nothing" —
    // that turned 26 live SKUs into "dead stock" the first time it happened.
    const r = assessSupplyChain({ ...base, planning: [] });
    expect(r.skus.every((s) => s.verdict !== "dead_stock")).toBe(true);
    const fast = r.skus.find((s) => s.sku === "FAST")!;
    expect(fast.verdict).toBe("no_data");
    expect(fast.reasons.join(" ")).toMatch(/no sales figures/i);
    expect(r.headlines.join(" ")).toMatch(/no sales figures in the planning report/);
  });

  it("treats a planning row with no units-shipped figure as missing data", () => {
    // BTBM005 arrived with days-of-cover but no sales column, and was called
    // dead stock on the strength of the row existing.
    const r = assessSupplyChain({
      ...base,
      planning: [{ sku: "DEAD", asin: "B03", sell_through: null, days_of_supply: 366, item_volume_cuft: null, units_shipped_t90: null }],
    });
    expect(r.skus.find((s) => s.sku === "DEAD")!.verdict).toBe("no_data");
  });

  it("says nothing about a SKU with neither sales nor stock", () => {
    const r = assessSupplyChain({ ...base, storageRows: [], awdStock: [], planning: [plan("X", "B09", 0, null)] });
    expect(r.skus.find((s) => s.sku === "X")!.verdict).toBe("no_data");
  });

  it("leads with the portfolio findings worth acting on", () => {
    const r = assessSupplyChain(base);
    expect(r.headlines.join(" ")).toMatch(/sold nothing in 90 days/);
    expect(r.headlines.join(" ")).toMatch(/26-week surcharge threshold/);
  });
});
