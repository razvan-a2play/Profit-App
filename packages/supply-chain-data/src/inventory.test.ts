import { describe, expect, it } from "vitest";
import { addInventory, attributeAwdHandling, receivingDates, reconstructAwdStock, type AwdMovements } from "./inventory";
import { buildMonthlyReport, type MonthCostsInput } from "./monthly";
import type { BilledCharge, BilledFees } from "./storageCosts";

const charge = (fee_type: string, group: BilledCharge["group"], amount: number, reference = ""): BilledCharge => ({
  fee_type, description: fee_type, group, amount, currency: "USD", reference, posted_date: null,
});
const billed = (charges: BilledCharge[], by_sku: BilledFees["by_sku"] = {}): BilledFees => ({
  ready: true, pages: 1, total: 0, by_group: {}, by_type: [], unrecognised_fee_types: [], charges, by_sku,
});

const movements: AwdMovements = {
  shipments: [
    { id: "STAR-AAA", status: "CLOSED", created: "2026-08-20", updated: "2026-09-10", skus: { a1: 300, B2: 100 } },
    { id: "STAR-OPEN", status: "IN_TRANSIT", created: "2026-09-25", updated: "2026-09-26", skus: { A1: 999 } },
  ],
  orders: [{ id: "repl-1111aaaa-22", status: "SUCCESS", created: "2026-09-15", updated: "2026-09-20", skus: { A1: 50 } }],
};

describe("reconstructAwdStock", () => {
  it("works month-ends back from today's stock", () => {
    const out = reconstructAwdStock(
      { A1: { available: 400, inbound: 0, reserved: 0, toFba: 0 } },
      movements,
      ["2026-08", "2026-09", "2026-10"],
      "2026-10-20",
    );
    // After Aug: +300 arrived (Sep 10), -50 left (Sep 15). So end of Aug = 400 - 300 + 50.
    expect(out.A1["2026-08"]).toBe(150);
    expect(out.A1["2026-09"]).toBe(400);
    // The current month ends after today: that is today's stock.
    expect(out.A1["2026-10"]).toBe(400);
  });

  it("ignores shipments that have not been received and never goes negative", () => {
    const out = reconstructAwdStock({}, movements, ["2026-08"], "2026-10-20");
    expect(out.B2["2026-08"]).toBe(0);
  });
});

describe("attributeAwdHandling", () => {
  it("divides a charge by the units its shipment or order moved", () => {
    const { bySku, unattributed } = attributeAwdHandling(
      {
        "2026-09": {
          billed: billed([
            charge("AmazonUpstreamProcessingFee", "awd_receiving", 40, "IB_2026-09-10_STAR-AAA"),
            charge("AmazonUpstreamStorageTransportationFee", "awd_transportation", 25, "repl-1111aaaa-22"),
            charge("AmazonUpstreamProcessingFee", "awd_receiving", 9, "IB_2026-09-11_STAR-UNKNOWN"),
          ]),
          storage: null,
        },
      },
      movements,
    );
    expect(bySku["2026-09"].A1.processing).toBe(30);
    expect(bySku["2026-09"].B2.processing).toBe(10);
    expect(bySku["2026-09"].A1.transport).toBe(25);
    expect(unattributed["2026-09"]).toBe(9);
  });
});

describe("addInventory", () => {
  const costsByMonth: Record<string, MonthCostsInput> = {
    "2026-09": {
      billed: billed([], {
        A1: { units_sold: 300, units_refunded: 0, sales: 6000, refunds: 0, fees: { FBAPerUnitFulfillmentFee: 1200 } },
      }),
      storage: null,
    },
    "2026-10": {
      billed: billed([charge("STARStorageFee", "awd_storage", 90, "US-2026-09-X")]),
      storage: null,
    },
  };
  const report = buildMonthlyReport({ months: ["2026-09"], costsByMonth, asinBySku: {} });
  const inv = addInventory(report, {
    ledger: {
      asins: {
        // Filed under an old SKU, as Amazon does; A1 sells this ASIN now.
        ASINA1: { "2026-09": { start: 900, end: 700, end_sellable: 690, receipts: 100, shipments: 300, returns: 0 } },
        ASINDEAD: { "2026-09": { start: 500, end: 500, end_sellable: 500, receipts: 0, shipments: 0, returns: 0 } },
      },
      mskus: { ASINA1: ["OLD-A1-PARENT"], ASINDEAD: ["DEAD"] },
    },
    asinBySku: { A1: "ASINA1", A1FBM: "ASINA1" },
    awdNow: { A1: { available: 400, inbound: 0, reserved: 0, toFba: 0 } },
    awdMovements: movements,
    agedBySku: { "2026-09": { DEAD: { units: 40, amount: 12.5, tiers: { "271-300": 12.5 } } } },
    unitCost: { A1: { cost: 2, source: "landed" }, DEAD: { cost: 1, source: "helium" } },
    costsByMonth,
    today: "2026-10-20",
  });

  const a1 = inv.skus.find((r) => r.sku === "A1")!;
  const dead = inv.skus.find((r) => r.sku === "DEAD")!;

  it("turns ledger balances into turnover and days of inventory", () => {
    // FBA avg 800; AWD: end Aug 150, end Sep 400 -> avg 275. Held 1075, shipped 300 in 30 days.
    expect(a1.avgUnitsHeld).toBe(1075);
    expect(a1.turnover).toBeCloseTo((300 / 1075) * (365 / 30), 2);
    expect(a1.daysOfInventory).toBe(Math.round(1075 / 10));
    expect(a1.inventoryValue).toBe((700 + 400) * 2);
  });

  it("adds stock-only SKUs, with their aged surcharge", () => {
    expect(dead.unitsSold).toBe(0);
    expect(dead.turnover).toBe(0);
    expect(dead.daysOfInventory).toBeNull();
    expect(dead.agedSurcharge).toBe(12.5);
  });

  it("gives the only SKU held at AWD the whole AWD bill", () => {
    expect(a1.awdStorage).toBe(90);
  });

  it("weights portfolio turnover by cost", () => {
    const m = inv.months[0];
    expect(m.cogsSold).toBe(600);
    expect(m.inventoryValue).toBe(2200 + 500);
    expect(m.turnover).toBeCloseTo((600 / (1075 * 2 + 500 * 1)) * (365 / 30), 2);
    expect(m.costCoverage).toBe(1);
  });
});

describe("AWD storage by cubic feet", () => {
  // Same AWD units; BIG takes four times the space per unit, so it carries four times the bill.
  const costsByMonth: Record<string, MonthCostsInput> = {
    "2026-09": {
      billed: billed([], {
        BIG: { units_sold: 10, units_refunded: 0, sales: 100, refunds: 0, fees: {} },
        SMALL: { units_sold: 10, units_refunded: 0, sales: 100, refunds: 0, fees: {} },
      }),
      storage: {
        ready: true,
        rows: [
          { asin: "ABIG", product_name: "Big", fee: 10, avg_units: 100, item_volume_cuft: 0.2 },
          { asin: "ASMALL", product_name: "Small", fee: 2.5, avg_units: 100, item_volume_cuft: 0.05 },
        ],
        totals: { fee: 12.5 },
      } as never,
    },
    "2026-10": { billed: billed([charge("STARStorageFee", "awd_storage", 100, "US-2026-09-X")]), storage: null },
  };
  const report = buildMonthlyReport({ months: ["2026-09"], costsByMonth, asinBySku: { BIG: "ABIG", SMALL: "ASMALL" } });
  const inv = addInventory(report, {
    ledger: null,
    asinBySku: { BIG: "ABIG", SMALL: "ASMALL" },
    awdNow: { BIG: { available: 500, inbound: 0, reserved: 0, toFba: 0 }, SMALL: { available: 500, inbound: 0, reserved: 0, toFba: 0 } },
    awdMovements: { shipments: [], orders: [] },
    agedBySku: {},
    unitCost: {},
    costsByMonth,
    today: "2026-10-20",
  });

  it("shares the month's AWD bill by units × cu ft per unit", () => {
    const big = inv.skus.find((r) => r.sku === "BIG")!;
    const small = inv.skus.find((r) => r.sku === "SMALL")!;
    expect(big.awdStorage).toBe(80);
    expect(small.awdStorage).toBe(20);
  });
});

describe("receiving dates", () => {
  it("dates an AWD arrival by its receiving fee, not by when the shipment closed", () => {
    const costs = {
      "2026-09": {
        billed: billed([
          charge("AmazonUpstreamProcessingFee", "awd_receiving", 5, "IB_2026-09-21_STAR-LATE"),
          charge("AmazonUpstreamProcessingFee", "awd_receiving", 5, "IB_2026-09-20_STAR-LATE"),
        ]),
        storage: null,
      },
    };
    const late: AwdMovements = {
      shipments: [{ id: "STAR-LATE", status: "CLOSED", created: "2026-09-01", updated: "2026-10-10", skus: { A1: 100 } }],
      orders: [],
    };
    const out = reconstructAwdStock(
      { A1: { available: 100, inbound: 0, reserved: 0, toFba: 0 } },
      late,
      ["2026-09"],
      "2026-10-20",
      receivingDates(costs),
    );
    // Received in September, so it was already there at the end of September.
    expect(out.A1["2026-09"]).toBe(100);
  });
});
