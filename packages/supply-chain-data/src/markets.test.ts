import { describe, expect, it } from "vitest";
import { billedForMarket, chargeMarket, storageForMarket, type BilledCharge, type BilledFees, type StorageFeeResult } from "./storageCosts";

const charge = (amount: number, currency: string, marketplace?: string): BilledCharge => ({
  fee_type: "FBAStorageFee", description: "", group: "fba_storage", amount, currency, reference: "", posted_date: null, marketplace,
});
const sku = (sales: number) => ({ units_sold: 1, units_refunded: 0, sales, refunds: 0, fees: {} });

describe("market views", () => {
  it("reads an untagged charge's marketplace from its currency", () => {
    expect(chargeMarket(charge(1, "CAD"))).toBe("CA");
    expect(chargeMarket(charge(1, "USD"))).toBe("US");
    expect(chargeMarket(charge(1, "USD", "CA"))).toBe("CA");
  });

  it("splits a signed, split month into each marketplace's own figures", () => {
    const b: BilledFees = {
      ready: true, pages: 1, total: 10, by_group: { fba_storage: 10 }, by_type: [], unrecognised_fee_types: [],
      charges: [charge(10, "USD", "US"), charge(14, "CAD", "CA")],
      by_sku: { A1: sku(100) },
      by_market: {
        US: { total: 10, by_group: { fba_storage: 10 }, by_type: [], currency: "USD", by_sku: { A1: sku(100) } },
        CA: { total: 14, by_group: { fba_storage: 14 }, by_type: [], currency: "CAD", by_sku: { A1: sku(140) } },
      },
    };
    const ca = billedForMarket(b, "CA");
    expect(ca.charges).toHaveLength(1);
    expect(ca.by_group.fba_storage).toBe(14);
    expect(ca.by_sku!.A1.sales).toBe(140);
    expect(billedForMarket(b, "US").by_sku!.A1.sales).toBe(100);
  });

  it("leaves Canada's sales unread in an older copy rather than borrowing the combined total", () => {
    const old: BilledFees = {
      ready: true, pages: 1, total: 24, by_group: {}, by_type: [], unrecognised_fee_types: [],
      charges: [charge(10, "USD"), charge(14, "CAD")], by_sku: { A1: sku(240) },
    };
    expect(billedForMarket(old, "CA").by_sku).toBeUndefined();
    expect(billedForMarket(old, "CA").by_group.fba_storage).toBe(14);
    expect(billedForMarket(old, "US").by_group.fba_storage).toBe(10);
  });

  it("keeps one country's storage rows and totals", () => {
    const s = {
      ready: true,
      rows: [{ asin: "B1", country: "US", fee: 5 }, { asin: "B1", country: "CA", fee: 2 }],
      totals: { fee: 5 },
      by_country: { US: { fee: 5 }, CA: { fee: 2 } },
    } as unknown as StorageFeeResult;
    const ca = storageForMarket(s, "CA");
    expect(ca.rows).toHaveLength(1);
    expect(ca.totals!.fee).toBe(2);
  });
});
