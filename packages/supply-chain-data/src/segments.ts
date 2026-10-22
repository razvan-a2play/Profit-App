// SKU classes, so the reports can be read for the sellers that carry the
// business apart from the long tail.
//
//   A        the top sellers: ranked by net sales over the last twelve months,
//            the SKUs that make the first 80% of sales
//   B        the next slice, up to 95%
//   C        the long tail, the last 5%
//   new      first sale in the last six months: no year of history to rank on
//   dormant  holding stock with no sale in the last three months
//
// Recomputed from whatever month it is "as of", so a SKU moves class as its
// sales move. A rolling year means a seasonal SKU is ranked on its whole year,
// not on its quiet months.

import type { InventoryMonthSummary, InventorySkuRow } from "./inventory";
import { daysInMonth } from "./inventory";

export type SkuClass = "A" | "B" | "C" | "new" | "dormant";

export const SKU_CLASSES: SkuClass[] = ["A", "B", "C", "new", "dormant"];
export const CLASS_A_SHARE = 0.8;
export const CLASS_B_SHARE = 0.95;
export const NEW_MONTHS = 6;
export const DORMANT_MONTHS = 3;

export interface SkuClassInfo {
  sku: string;
  cls: SkuClass;
  /** Net sales over the twelve months to the as-of month. */
  sales12: number;
  /** Share of the A/B/C pool's sales, and the running share down the ranking (A/B/C only). */
  share: number | null;
  cumShare: number | null;
  firstSale: string | null;
  lastSale: string | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Every SKU that sold or held stock, classed as of `asOf` (a "YYYY-MM" month). */
export function classifySkus(rows: InventorySkuRow[], asOf: string): Record<string, SkuClassInfo> {
  const upTo = rows.filter((r) => r.month <= asOf);
  const earliest = upTo.reduce((min, r) => (r.month < min ? r.month : min), asOf);
  const from12 = shift(asOf, -11);
  const newSince = shift(asOf, -(NEW_MONTHS - 1));
  const soldSince = shift(asOf, -(DORMANT_MONTHS - 1));

  const by = new Map<string, { sales12: number; firstSale: string | null; lastSale: string | null; stockNow: boolean }>();
  for (const r of upTo) {
    const s = by.get(r.sku) ?? { sales12: 0, firstSale: null, lastSale: null, stockNow: false };
    if (r.month >= from12) s.sales12 += r.netSales;
    if (r.unitsSold > 0) {
      if (!s.firstSale || r.month < s.firstSale) s.firstSale = r.month;
      if (!s.lastSale || r.month > s.lastSale) s.lastSale = r.month;
    }
    if (r.month === asOf) s.stockNow = (r.avgUnitsHeld ?? 0) > 0 || (r.fbaUnitsEnd ?? 0) + (r.awdUnitsEnd ?? 0) > 0;
    by.set(r.sku, s);
  }

  const out: Record<string, SkuClassInfo> = {};
  const pool: Array<[string, number]> = [];
  for (const [sku, s] of by) {
    const info = { sku, sales12: Math.round(s.sales12), share: null, cumShare: null, firstSale: s.firstSale, lastSale: s.lastSale };
    // A first sale in the data's very first month says nothing: the SKU may be years old.
    if (s.firstSale && s.firstSale >= newSince && s.firstSale > earliest) out[sku] = { ...info, cls: "new" };
    else if ((!s.lastSale || s.lastSale < soldSince) && s.stockNow) out[sku] = { ...info, cls: "dormant" };
    else if (s.sales12 > 0) pool.push([sku, s.sales12]);
  }
  pool.sort((a, b) => b[1] - a[1]);
  const total = sum(pool.map(([, v]) => v));
  let before = 0;
  for (const [sku, sales] of pool) {
    // A SKU belongs to A if A wasn't yet full when it was reached: the one that crosses 80% is in.
    const cls: SkuClass = before < CLASS_A_SHARE * total ? "A" : before < CLASS_B_SHARE * total ? "B" : "C";
    before += sales;
    const s = by.get(sku)!;
    out[sku] = { sku, cls, sales12: Math.round(sales), share: sales / total, cumShare: before / total, firstSale: s.firstSale, lastSale: s.lastSale };
  }
  return out;
}

/**
 * The month totals for a set of SKUs, rebuilt from their rows the way the
 * account's are. Where Amazon only gives an account figure, it is shared out:
 * inbound by units received, other order fees and removals by net sales, and
 * the aged surcharge (for months before the per-SKU aged report) by FBA storage
 * cost; the storage utilisation ratio has no per-SKU form and is left blank.
 */
export function monthsForSkus(months: InventoryMonthSummary[], rows: InventorySkuRow[], keep: Set<string>): InventoryMonthSummary[] {
  const byMonth = new Map<string, InventorySkuRow[]>();
  for (const r of rows) byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r]);

  return months.map((acct) => {
    const all = byMonth.get(acct.month) ?? [];
    const rs = all.filter((r) => keep.has(r.sku));
    const days = daysInMonth(acct.month);
    const tot = (pick: (r: InventorySkuRow) => number | null | undefined) => sum(rs.map((r) => pick(r) ?? 0));
    const netSales = tot((r) => r.netSales);
    const share = acct.netSales > 0 ? netSales / acct.netSales : 0;
    const received = tot((r) => r.unitsReceived);
    const receivedAll = sum(all.map((r) => r.unitsReceived ?? 0));

    const unitsSold = tot((r) => r.unitsSold);
    const fulfilmentFees = tot((r) => r.fulfilmentFees);
    const awdProcessing = tot((r) => r.awdProcessing);
    const awdTransport = tot((r) => r.awdTransport);
    const fbaInbound = acct.fbaInbound * (receivedAll > 0 ? received / receivedAll : share);
    const removals = acct.removals * share;
    // A month's per-SKU figure exists only when Amazon's per-SKU report does; otherwise it stays unknown.
    const perSku = (pick: (r: InventorySkuRow) => number | null, account: number | null) =>
      account == null || !all.some((r) => pick(r) != null) ? null : tot(pick);
    const fbaStorage = perSku((r) => r.fbaStorage, acct.fbaStorage);
    // Before Amazon's per-SKU aged report begins, the account's surcharge is
    // shared by FBA storage cost: it is charged on FBA stock, by volume.
    const fbaStorageAll = sum(all.map((r) => r.fbaStorage ?? 0));
    const agedSurcharge =
      perSku((r) => r.agedSurcharge, acct.agedSurcharge) ??
      (acct.agedSurcharge != null && fbaStorage != null && fbaStorageAll > 0 ? acct.agedSurcharge * (fbaStorage / fbaStorageAll) : null);
    const awdStorage = perSku((r) => r.awdStorage, acct.awdStorage);
    const storage = fbaStorage != null && awdStorage != null ? fbaStorage + awdStorage + (agedSurcharge ?? 0) : null;
    const supplyChainCost =
      fulfilmentFees + (fbaStorage ?? 0) + (agedSurcharge ?? 0) + (awdStorage ?? 0) + awdProcessing + awdTransport + fbaInbound + removals;

    const costed = rs.filter((r) => r.unitCost != null);
    const heldValue = sum(costed.map((r) => (r.avgUnitsHeld ?? 0) * r.unitCost!));
    const cogsSold = sum(costed.map((r) => r.cogsSold ?? 0));
    const anyLedger = rs.some((r) => r.fbaUnitsEnd != null);
    const anyAwd = rs.some((r) => r.awdUnitsEnd != null);
    const stocked = rs.filter((r) => r.inStockShare != null && r.inStockWeight);
    const weight = sum(stocked.map((r) => r.inStockWeight!));

    return {
      ...acct,
      unitsSold,
      unitsRefunded: tot((r) => r.unitsRefunded),
      grossSales: acct.grossSales * share,
      refunds: acct.refunds * share,
      netSales,
      fulfilmentFees,
      referralFees: tot((r) => r.referralFees),
      otherOrderFees: acct.otherOrderFees * share,
      fbaStorage,
      agedSurcharge,
      awdStorage,
      awdProcessing,
      awdTransport,
      fbaInbound,
      removals,
      supplyChainCost,
      storageShareOfSales: storage != null && netSales > 0 ? storage / netSales : null,
      supplyChainShareOfSales: netSales > 0 ? supplyChainCost / netSales : null,
      fulfilmentPerUnit: unitsSold > 0 ? fulfilmentFees / unitsSold : null,
      utilizationWeeks: null,
      avgUnitsStored: rs.some((r) => r.avgUnitsStored != null) ? tot((r) => r.avgUnitsStored) : null,

      fbaUnitsEnd: anyLedger ? tot((r) => r.fbaUnitsEnd) : null,
      awdUnitsEnd: anyAwd ? tot((r) => r.awdUnitsEnd) : null,
      inventoryValue: costed.length ? sum(costed.map((r) => r.inventoryValue ?? 0)) : null,
      cogsSold: costed.length ? cogsSold : null,
      turnover: heldValue > 0 ? (cogsSold / heldValue) * (365 / days) : null,
      daysOfInventory: cogsSold > 0 ? Math.round(heldValue / (cogsSold / days)) : null,
      costCoverage: netSales > 0 ? sum(costed.map((r) => r.netSales)) / netSales : null,
      awdUnattributed: 0,
      agedSurchargeBySku: agedSurcharge,
      unitsShipped: anyLedger ? tot((r) => r.unitsShipped) : null,
      unitsReceived: anyLedger ? received : null,
      fbaUnitsAvg: anyLedger ? tot((r) => r.fbaUnitsAvg) : null,
      awdUnitsAvg: anyAwd ? tot((r) => r.awdUnitsAvg) : null,
      heldValue: costed.length ? heldValue : null,
      excessValue: costed.length ? sum(costed.filter((r) => r.excessStock).map((r) => r.inventoryValue ?? 0)) : null,
      deadValue: costed.length ? sum(costed.filter((r) => (r.unitsShipped ?? 0) === 0).map((r) => r.inventoryValue ?? 0)) : null,
      inStockRate: weight > 0 ? sum(stocked.map((r) => r.inStockShare! * r.inStockWeight!)) / weight : null,
      skusStockedOut: weight > 0 ? stocked.filter((r) => r.inStockShare! < 0.95).length : null,
    };
  });
}
