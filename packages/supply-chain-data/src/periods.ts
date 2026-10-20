// Months rolled up into quarters and years, and each period set against the one
// before it and the same period a year earlier.
//
// Comparisons are like for like: the base is the same months shifted back, so
// a year that has only reached September is compared with January–September of
// the year before, never with a whole year. Flows (sales, fees, storage) are
// summed; stock is taken at the period's end; turnover, GMROI and the shares
// are recomputed from the sums rather than averaged, because an average of
// ratios weights a quiet month as heavily as a busy one.
//
// A figure is null rather than partial when any month in the period lacks it:
// a quarter with one month unread would otherwise read as a cheap quarter.

import type { InventoryMonthSummary, InventorySkuRow } from "./inventory";
import { daysInMonth } from "./inventory";

export type Granularity = "month" | "quarter" | "year";

export interface PeriodSummary {
  key: string;
  granularity: Granularity;
  months: string[];
  /** Months in the period whose fees have been read. */
  feeMonths: number;
  /** A year that has not yet run all twelve months. */
  toDate: boolean;
  days: number;

  unitsSold: number | null;
  unitsRefunded: number | null;
  netSales: number | null;
  fulfilmentFees: number | null;
  referralFees: number | null;
  otherOrderFees: number | null;
  fbaStorage: number | null;
  agedSurcharge: number | null;
  awdStorage: number | null;
  awdHandling: number | null;
  fbaInbound: number | null;
  removals: number | null;
  supplyChainCost: number | null;
  cogsSold: number | null;
  unitsShipped: number | null;
  unitsReceived: number | null;

  fbaUnitsEnd: number | null;
  awdUnitsEnd: number | null;
  inventoryValue: number | null;
  excessValue: number | null;
  deadValue: number | null;
  utilizationWeeks: number | null;

  // ── KPIs ──
  fulfilmentPerUnit: number | null;
  /** Everything but Amazon's per-unit fulfilment fee — storage, AWD, aged, inbound, removals — per unit sold. */
  controllablePerUnit: number | null;
  supplyChainPerUnit: number | null;
  /** Days-weighted average of the months' in-stock rates. */
  inStockRate: number | null;
  /** Most SKUs out of stock more than 5% of any one month in the period. */
  skusStockedOut: number | null;
  storageShareOfSales: number | null;
  supplyChainShareOfSales: number | null;
  /** Times stock turned, annualised, at cost. */
  turnover: number | null;
  daysOfInventory: number | null;
  /** Everything a sold unit cost to make, move, store and fulfil. */
  landedCostPerUnit: number | null;
  /** Net sales less COGS, Amazon fees and supply-chain cost. */
  contributionMargin: number | null;
  contributionShare: number | null;
  /** Contribution per dollar of stock held, annualised. */
  gmroi: number | null;
  /** Units shipped over units shipped plus closing stock. */
  sellThrough: number | null;
  refundRate: number | null;
  fbaStoragePerUnitMonth: number | null;
  awdStoragePerUnitMonth: number | null;
  inboundPerUnitReceived: number | null;
  excessShare: number | null;
  /** Share of closing stock held at AWD. */
  awdShare: number | null;
}

export interface Change {
  prev: PeriodSummary | null;
  yoy: PeriodSummary | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function periodKey(month: string, g: Granularity): string {
  const [y, m] = month.split("-").map(Number);
  if (g === "year") return String(y);
  if (g === "quarter") return `${y}-Q${Math.ceil(m / 3)}`;
  return month;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const LENGTH: Record<Granularity, number> = { month: 1, quarter: 3, year: 12 };

/**
 * Roll months up. `feeReady` names the months whose fee scan has finished; a
 * month outside it contributes nothing to the flows, and makes them null.
 */
export function aggregatePeriods(
  months: InventoryMonthSummary[],
  g: Granularity,
  feeReady: Set<string>,
): PeriodSummary[] {
  const groups = new Map<string, InventoryMonthSummary[]>();
  for (const m of [...months].sort((a, b) => a.month.localeCompare(b.month))) {
    const k = periodKey(m.month, g);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups.entries()].map(([key, ms]) => summarise(key, g, ms, feeReady));
}

/** The same months shifted back, summarised the same way — the base of a comparison. */
function baseFor(p: PeriodSummary, by: number, byMonth: Map<string, InventoryMonthSummary>, feeReady: Set<string>) {
  const shifted = p.months.map((m) => byMonth.get(shiftMonth(m, by)));
  if (shifted.some((m) => !m)) return null;
  return summarise(periodKey(shiftMonth(p.months[0], by), p.granularity), p.granularity, shifted as InventoryMonthSummary[], feeReady);
}

export function comparePeriods(
  periods: PeriodSummary[],
  months: InventoryMonthSummary[],
  feeReady: Set<string>,
): Map<string, Change> {
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const out = new Map<string, Change>();
  for (const p of periods) {
    out.set(p.key, {
      prev: p.granularity === "year" ? baseFor(p, -12, byMonth, feeReady) : baseFor(p, -LENGTH[p.granularity], byMonth, feeReady),
      yoy: baseFor(p, -12, byMonth, feeReady),
    });
  }
  return out;
}

function summarise(key: string, g: Granularity, ms: InventoryMonthSummary[], feeReady: Set<string>): PeriodSummary {
  const fees = ms.filter((m) => feeReady.has(m.month) && !m.salesMissing);
  const allFees = fees.length === ms.length && ms.length > 0;
  const days = sum(ms.map((m) => daysInMonth(m.month)));
  const last = ms[ms.length - 1];

  /** Sum over the period, or null if any month lacks the figure. */
  const flow = (pick: (m: InventoryMonthSummary) => number | null, needFees = true): number | null => {
    if (needFees && !allFees) return null;
    const vals = ms.map(pick);
    return vals.some((v) => v == null) ? null : round(sum(vals as number[]));
  };
  const avg = (pick: (m: InventoryMonthSummary) => number | null): number | null => {
    const vals = ms.map(pick);
    return vals.some((v) => v == null) ? null : sum(vals as number[]) / vals.length;
  };

  const unitsSold = flow((m) => m.unitsSold);
  const netSales = flow((m) => m.netSales);
  const fulfilmentFees = flow((m) => m.fulfilmentFees);
  const referralFees = flow((m) => m.referralFees);
  const otherOrderFees = flow((m) => m.otherOrderFees);
  const fbaStorage = flow((m) => m.fbaStorage);
  const agedSurcharge = flow((m) => m.agedSurcharge);
  const awdStorage = flow((m) => m.awdStorage);
  const awdHandling = flow((m) => m.awdProcessing + m.awdTransport);
  const fbaInbound = flow((m) => m.fbaInbound);
  const removals = flow((m) => m.removals);
  const supplyChainCost =
    [fulfilmentFees, fbaStorage, agedSurcharge, awdStorage, awdHandling, fbaInbound, removals].some((v) => v == null)
      ? null
      : round(sum([fulfilmentFees!, fbaStorage!, agedSurcharge!, awdStorage!, awdHandling!, fbaInbound!, removals!]));
  const cogsSold = flow((m) => m.cogsSold, false);
  const unitsShipped = flow((m) => m.unitsShipped, false);
  const unitsReceived = flow((m) => m.unitsReceived, false);
  const heldValue = avg((m) => m.heldValue);
  const fbaUnitMonths = flow((m) => m.fbaUnitsAvg, false);
  const awdUnitMonths = flow((m) => m.awdUnitsAvg, false);

  const endUnits = last.fbaUnitsEnd != null || last.awdUnitsEnd != null ? (last.fbaUnitsEnd ?? 0) + (last.awdUnitsEnd ?? 0) : null;
  // COGS of the units the order lines sold, at the period's average cost per shipped unit.
  const cogsOfSales =
    cogsSold != null && unitsShipped && unitsSold != null ? (cogsSold / unitsShipped) * unitsSold : null;
  const contribution =
    netSales != null && cogsOfSales != null && referralFees != null && otherOrderFees != null && supplyChainCost != null
      ? netSales - cogsOfSales - referralFees - otherOrderFees - supplyChainCost
      : null;
  const storage = fbaStorage != null && awdStorage != null && agedSurcharge != null ? fbaStorage + awdStorage + agedSurcharge : null;
  const ann = 365 / days;

  return {
    key,
    granularity: g,
    months: ms.map((m) => m.month),
    feeMonths: fees.length,
    toDate: g === "year" && ms.length < 12,
    days,
    unitsSold,
    unitsRefunded: flow((m) => m.unitsRefunded),
    netSales,
    fulfilmentFees,
    referralFees,
    otherOrderFees,
    fbaStorage,
    agedSurcharge,
    awdStorage,
    awdHandling,
    fbaInbound,
    removals,
    supplyChainCost,
    cogsSold,
    unitsShipped,
    unitsReceived,
    fbaUnitsEnd: last.fbaUnitsEnd,
    awdUnitsEnd: last.awdUnitsEnd,
    inventoryValue: last.inventoryValue,
    excessValue: last.excessValue,
    deadValue: last.deadValue,
    utilizationWeeks: [...ms].reverse().find((m) => m.utilizationWeeks != null)?.utilizationWeeks ?? null,

    fulfilmentPerUnit: div(fulfilmentFees, unitsSold, 3),
    controllablePerUnit:
      supplyChainCost != null && fulfilmentFees != null && unitsSold ? round((supplyChainCost - fulfilmentFees) / unitsSold, 3) : null,
    supplyChainPerUnit: div(supplyChainCost, unitsSold, 3),
    inStockRate: ms.some((m) => m.inStockRate == null)
      ? null
      : round(sum(ms.map((m) => m.inStockRate! * daysInMonth(m.month))) / days, 4),
    skusStockedOut: ms.some((m) => m.skusStockedOut == null) ? null : Math.max(...ms.map((m) => m.skusStockedOut!)),
    storageShareOfSales: div(storage, netSales, 4),
    supplyChainShareOfSales: div(supplyChainCost, netSales, 4),
    turnover: heldValue && cogsSold != null ? round((cogsSold / heldValue) * ann, 2) : null,
    daysOfInventory: heldValue != null && cogsSold ? Math.round(heldValue / (cogsSold / days)) : null,
    landedCostPerUnit:
      cogsSold != null && unitsShipped && supplyChainCost != null && unitsSold
        ? round(cogsSold / unitsShipped + supplyChainCost / unitsSold, 2)
        : null,
    contributionMargin: contribution != null ? round(contribution) : null,
    contributionShare: div(contribution, netSales, 4),
    gmroi: contribution != null && heldValue ? round((contribution / heldValue) * ann, 2) : null,
    sellThrough: unitsShipped != null && endUnits != null && unitsShipped + endUnits > 0 ? round(unitsShipped / (unitsShipped + endUnits), 4) : null,
    refundRate: div(flow((m) => m.unitsRefunded), unitsSold, 4),
    fbaStoragePerUnitMonth: div(fbaStorage, fbaUnitMonths, 4),
    awdStoragePerUnitMonth: div(awdStorage, awdUnitMonths, 4),
    inboundPerUnitReceived: div(fbaInbound, unitsReceived, 3),
    excessShare: div(last.excessValue, last.inventoryValue, 4),
    awdShare: endUnits ? round((last.awdUnitsEnd ?? 0) / endUnits, 4) : null,
  };
}

// ── per SKU ────────────────────────────────────────────────────────────────

export interface SkuPeriodRow {
  sku: string;
  asin: string;
  productName: string;
  unitsSold: number;
  netSales: number;
  fulfilmentFees: number;
  fulfilmentPerUnit: number | null;
  fbaStorage: number | null;
  awdCost: number;
  agedSurcharge: number;
  unitsShipped: number;
  fbaUnitsEnd: number | null;
  awdUnitsEnd: number | null;
  inventoryValue: number | null;
  unitCost: number | null;
  costSource: InventorySkuRow["costSource"];
  turnover: number | null;
  daysOfInventory: number | null;
  storageShareOfSales: number | null;
  costShareOfSales: number | null;
  /** Change against the comparison period, when it has the SKU. */
  netSalesChange: number | null;
  unitsChange: number | null;
  costShareChange: number | null;
  daysOfInventoryChange: number | null;
}

type SkuAggregate = Omit<SkuPeriodRow, "netSalesChange" | "unitsChange" | "costShareChange" | "daysOfInventoryChange">;

/** One row per SKU for a set of months; stock is the last month's. */
export function aggregateSkus(rows: InventorySkuRow[], months: string[]): Map<string, SkuAggregate> {
  const wanted = new Set(months);
  const lastMonth = months[months.length - 1];
  const days = sum(months.map(daysInMonth));
  const bySku = new Map<string, InventorySkuRow[]>();
  for (const r of rows) if (wanted.has(r.month)) bySku.set(r.sku, [...(bySku.get(r.sku) ?? []), r]);

  const out = new Map<string, SkuAggregate>();
  for (const [sku, rs] of bySku) {
    const end = rs.find((r) => r.month === lastMonth);
    const unitsSold = sum(rs.map((r) => r.unitsSold));
    const netSales = sum(rs.map((r) => r.netSales));
    const fulfilment = sum(rs.map((r) => r.fulfilmentFees));
    const storageKnown = rs.every((r) => r.fbaStorage != null);
    const fbaStorage = storageKnown ? sum(rs.map((r) => r.fbaStorage ?? 0)) : null;
    const shipped = sum(rs.map((r) => r.unitsShipped ?? 0));
    const cost = end?.unitCost ?? rs.find((r) => r.unitCost != null)?.unitCost ?? null;
    // Months the SKU has no row held nothing and sold nothing: they count as zero.
    const heldUnits = sum(rs.map((r) => r.avgUnitsHeld ?? 0)) / months.length;
    out.set(sku, {
      sku,
      asin: rs.find((r) => r.asin)?.asin ?? "",
      productName: rs.find((r) => r.productName)?.productName ?? "",
      unitsSold,
      netSales: round(netSales),
      fulfilmentFees: round(fulfilment),
      fulfilmentPerUnit: unitsSold > 0 ? round(fulfilment / unitsSold, 3) : null,
      fbaStorage: fbaStorage != null ? round(fbaStorage) : null,
      awdCost: round(sum(rs.map((r) => r.awdProcessing + r.awdTransport + (r.awdStorage ?? 0)))),
      agedSurcharge: round(sum(rs.map((r) => r.agedSurcharge ?? 0))),
      unitsShipped: shipped,
      fbaUnitsEnd: end?.fbaUnitsEnd ?? null,
      awdUnitsEnd: end?.awdUnitsEnd ?? null,
      inventoryValue: end?.inventoryValue ?? null,
      unitCost: cost,
      costSource: end?.costSource ?? rs.find((r) => r.costSource)?.costSource ?? null,
      turnover: heldUnits > 0 ? round((shipped / heldUnits) * (365 / days), 2) : null,
      daysOfInventory: shipped > 0 ? Math.round(heldUnits / (shipped / days)) : null,
      storageShareOfSales: fbaStorage != null && netSales > 0 ? round(fbaStorage / netSales, 4) : null,
      costShareOfSales: netSales > 0 ? round((fulfilment + (fbaStorage ?? 0)) / netSales, 4) : null,
    });
  }
  return out;
}

export function skuPeriodRows(rows: InventorySkuRow[], months: string[], baseMonths: string[] | null): SkuPeriodRow[] {
  const cur = aggregateSkus(rows, months);
  const base = baseMonths ? aggregateSkus(rows, baseMonths) : null;
  return [...cur.values()].map((r) => {
    const b = base?.get(r.sku);
    return {
      ...r,
      netSalesChange: b && b.netSales > 0 ? round((r.netSales - b.netSales) / b.netSales, 4) : null,
      unitsChange: b && b.unitsSold > 0 ? round((r.unitsSold - b.unitsSold) / b.unitsSold, 4) : null,
      costShareChange: b && r.costShareOfSales != null && b.costShareOfSales != null ? round(r.costShareOfSales - b.costShareOfSales, 4) : null,
      daysOfInventoryChange: b && r.daysOfInventory != null && b.daysOfInventory != null ? r.daysOfInventory - b.daysOfInventory : null,
    };
  });
}

// ── deltas ─────────────────────────────────────────────────────────────────

/** Relative change, or null when either side is missing or the base is zero. */
export function pctChange(cur: number | null | undefined, base: number | null | undefined): number | null {
  if (cur == null || base == null || base === 0) return null;
  return (cur - base) / Math.abs(base);
}

/** Difference in a share, in fractional points (0.012 = 1.2 pp). */
export function ppChange(cur: number | null | undefined, base: number | null | undefined): number | null {
  if (cur == null || base == null) return null;
  return cur - base;
}

function div(a: number | null, b: number | null, dp: number): number | null {
  return a != null && b ? round(a / b, dp) : null;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
