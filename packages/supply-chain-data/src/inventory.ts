// Stock behind each month: how much was held, how fast it turned, and what AWD
// cost each SKU.
//
// FBA stock is MEASURED: Amazon's monthly ledger gives opening and closing
// balances per SKU. AWD stock is RECONSTRUCTED: the AWD API only reports today,
// so each past month-end is worked back from today's stock using the inbound
// shipments that arrived and the replenishment orders that left since. AWD
// processing and transport are ATTRIBUTED: each charge names the STAR shipment
// or replenishment order it was for, so it is divided by the units that
// shipment or order moved. AWD storage is billed to the account and is
// ALLOCATED by each SKU's share of reconstructed AWD stock.

import type { BilledCharge } from "./storageCosts";
import type { MonthCostsInput, MonthlyReport, SkuMonthRow, MonthSummary } from "./monthly";
import { awdStorageEffect, storageMonthOf } from "./monthly";

export interface LedgerMonth {
  start: number;
  end: number;
  end_sellable: number;
  receipts: number;
  shipments: number;
  returns: number;
}
/** Amazon's monthly ledger, per ASIN (it files stock under whichever SKU sent it in). */
export interface LedgerByAsin {
  asins: Record<string, Record<string, LedgerMonth>>;
  /** The SKUs the ledger used for each ASIN, for stock no current SKU claims. */
  mskus?: Record<string, string[]>;
}

export interface AwdMovement {
  id: string;
  status: string;
  created: string;
  updated: string;
  skus: Record<string, number>;
}
export interface AwdMovements {
  shipments: AwdMovement[];
  orders: AwdMovement[];
}

export interface AwdNow {
  available: number;
  inbound: number;
  reserved: number;
  toFba: number;
}

export interface AgedSurchargeSku {
  units: number;
  amount: number;
  tiers: Record<string, number>;
}

export interface UnitCost {
  cost: number;
  source: "landed" | "helium";
}

export interface InventoryInputs {
  ledger: LedgerByAsin | null;
  /** Catalogue SKU -> ASIN (upper-case SKUs), to hand each ASIN's ledger to the SKU that sells it. */
  asinBySku: Record<string, string>;
  productNameBySku?: Record<string, string>;
  awdNow: Record<string, AwdNow> | null;
  awdMovements: AwdMovements | null;
  /** month -> sku -> aged surcharge Amazon charged that month. */
  agedBySku: Record<string, Record<string, AgedSurchargeSku>>;
  unitCost: Record<string, UnitCost>;
  /** asin -> month -> [days with sellable US stock, days observed], from the daily ledger. */
  inStock?: Record<string, Record<string, [number, number]>> | null;
  costsByMonth: Record<string, MonthCostsInput | null | undefined>;
  /** Today, for the AWD walk-back and the current month's end. Injectable for tests. */
  today?: string;
}

export interface SkuInventory {
  fbaUnitsEnd: number | null;
  awdUnitsEnd: number | null;
  avgUnitsHeld: number | null;
  fbaUnitsAvg: number | null;
  awdUnitsAvg: number | null;
  unitsShipped: number | null;
  /** Units received into FBA (from suppliers and from AWD), per the ledger. */
  unitsReceived: number | null;
  unitCost: number | null;
  costSource: UnitCost["source"] | null;
  inventoryValue: number | null;
  cogsSold: number | null;
  /** Times the stock turned over, annualised. */
  turnover: number | null;
  daysOfInventory: number | null;
  awdProcessing: number;
  awdTransport: number;
  /** Share of the month's AWD storage, by cubic feet held (reconstructed AWD units × cu ft per unit). */
  awdStorage: number | null;
  agedSurcharge: number | null;
  agedUnits: number | null;
}

export type InventorySkuRow = SkuMonthRow & SkuInventory;

export interface InventoryMonth {
  fbaUnitsEnd: number | null;
  awdUnitsEnd: number | null;
  inventoryValue: number | null;
  cogsSold: number | null;
  /** Cost-weighted, over SKUs with a known unit cost. */
  turnover: number | null;
  daysOfInventory: number | null;
  /** Share of net sales from SKUs that have a unit cost. */
  costCoverage: number | null;
  /** AWD processing + transport whose shipment or order could not be found. */
  awdUnattributed: number;
  agedSurchargeBySku: number | null;
  /** Ledger totals across SKUs. */
  unitsShipped: number | null;
  unitsReceived: number | null;
  /** Average units held in the month, by channel. */
  fbaUnitsAvg: number | null;
  awdUnitsAvg: number | null;
  /** Average stock held, at cost (SKUs with a unit cost). The base of turnover and GMROI. */
  heldValue: number | null;
  /** Stock at cost on SKUs holding more than 180 days at their trailing 90-day pace. */
  excessValue: number | null;
  /** Stock at cost on SKUs that shipped nothing this month. */
  deadValue: number | null;
  /** Share of days SKUs could sell, weighted by each SKU's typical shipping pace. */
  inStockRate: number | null;
  /** SKUs that sell and spent more than 5% of the month without sellable stock. */
  skusStockedOut: number | null;
}

/** Cover beyond this is excess: past it, stock starts paying the aged surcharge. */
export const EXCESS_DAYS = 180;

export type InventoryMonthSummary = MonthSummary & InventoryMonth;

export interface InventoryReport {
  months: InventoryMonthSummary[];
  skus: InventorySkuRow[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const up = (s: string) => s.trim().toUpperCase();

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Last calendar day of the month, as YYYY-MM-DD. */
function monthEnd(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}

const RECEIVED = new Set(["RECEIVED", "CLOSED", "CHECKED_IN"]);
const LEFT_AWD = new Set(["SUCCESS", "INVENTORY_OUTBOUND", "RECEIVED", "COMPLETED"]);

/**
 * Date units arrived at AWD. The receiving fee names the day it was charged
 * ("IB_2026-09-20_STAR-…"), which is the real arrival; a shipment's last-update
 * date can be weeks later, once it closes. That is the fallback only.
 */
function arrivedOn(s: AwdMovement, received?: Map<string, string>): string | null {
  const fromFee = received?.get(s.id.toUpperCase());
  if (fromFee) return fromFee;
  return RECEIVED.has(s.status) ? s.updated || s.created || null : null;
}

/** STAR id -> earliest day AWD charged to receive it, from the processing fees. */
export function receivingDates(costsByMonth: Record<string, MonthCostsInput | null | undefined>): Map<string, string> {
  const out = new Map<string, string>();
  for (const costs of Object.values(costsByMonth)) {
    for (const c of costs?.billed?.ready ? costs.billed.charges : []) {
      if (c.group !== "awd_receiving") continue;
      const m = /IB_(\d{4}-\d{2}-\d{2})_(STAR-[A-Z0-9]+)/i.exec(c.reference ?? "");
      if (!m) continue;
      const id = m[2].toUpperCase();
      if (!out.has(id) || m[1] < out.get(id)!) out.set(id, m[1]);
    }
  }
  return out;
}

/** Date units left AWD for FBA: replenishment orders ship within days of being placed. */
function leftOn(o: AwdMovement): string | null {
  return LEFT_AWD.has(o.status) ? o.created || o.updated || null : null;
}

/**
 * AWD units on hand at each month-end, worked back from today:
 *   stock(end of M) = stock now − arrivals after M + departures after M
 * Clamped at zero; a negative means a movement fell outside the history Amazon
 * returned, and is reported as zero rather than as stock that never existed.
 */
export function reconstructAwdStock(
  now: Record<string, AwdNow>,
  movements: AwdMovements,
  months: string[],
  today: string,
  received?: Map<string, string>,
): Record<string, Record<string, number>> {
  const onHandNow = new Map<string, number>();
  for (const [sku, s] of Object.entries(now)) onHandNow.set(up(sku), s.available + s.reserved + s.toFba);

  const events: Array<{ sku: string; date: string; delta: number }> = [];
  for (const s of movements.shipments) {
    const d = arrivedOn(s, received);
    if (d) for (const [sku, q] of Object.entries(s.skus)) events.push({ sku: up(sku), date: d, delta: q });
  }
  for (const o of movements.orders) {
    const d = leftOn(o);
    if (d) for (const [sku, q] of Object.entries(o.skus)) events.push({ sku: up(sku), date: d, delta: -q });
  }

  const skus = new Set([...onHandNow.keys(), ...events.map((e) => e.sku)]);
  const out: Record<string, Record<string, number>> = {};
  for (const sku of skus) {
    const mine = events.filter((e) => e.sku === sku);
    out[sku] = {};
    for (const m of months) {
      const end = monthEnd(m);
      if (end >= today) {
        out[sku][m] = onHandNow.get(sku) ?? 0;
        continue;
      }
      const after = sum(mine.filter((e) => e.date > end && e.date <= today).map((e) => e.delta));
      out[sku][m] = Math.max(0, (onHandNow.get(sku) ?? 0) - after);
    }
  }
  return out;
}

const STAR_RE = /STAR-[A-Z0-9]+/i;
const REPL_RE = /repl-[0-9a-f-]{8,}/i;

/**
 * Divide each AWD processing / transport charge among the SKUs its shipment or
 * replenishment order moved. Returns month -> sku -> {processing, transport},
 * plus whatever could not be matched, per month.
 */
export function attributeAwdHandling(
  costsByMonth: Record<string, MonthCostsInput | null | undefined>,
  movements: AwdMovements,
): {
  bySku: Record<string, Record<string, { processing: number; transport: number }>>;
  unattributed: Record<string, number>;
} {
  const byId = new Map<string, Record<string, number>>();
  for (const s of movements.shipments) byId.set(s.id.toUpperCase(), s.skus);
  for (const o of movements.orders) byId.set(o.id.toLowerCase(), o.skus);

  const bySku: Record<string, Record<string, { processing: number; transport: number }>> = {};
  const unattributed: Record<string, number> = {};
  for (const [month, costs] of Object.entries(costsByMonth)) {
    if (!costs?.billed?.ready) continue;
    for (const c of costs.billed.charges) {
      if (c.group !== "awd_receiving" && c.group !== "awd_transportation") continue;
      const skus = lookup(c, byId);
      const total = skus ? sum(Object.values(skus)) : 0;
      if (!skus || total <= 0) {
        unattributed[month] = (unattributed[month] ?? 0) + c.amount;
        continue;
      }
      for (const [sku, q] of Object.entries(skus)) {
        const rec = ((bySku[month] ??= {})[up(sku)] ??= { processing: 0, transport: 0 });
        const share = (c.amount * q) / total;
        if (c.group === "awd_receiving") rec.processing += share;
        else rec.transport += share;
      }
    }
  }
  return { bySku, unattributed };
}

function lookup(c: BilledCharge, byId: Map<string, Record<string, number>>): Record<string, number> | null {
  const star = STAR_RE.exec(c.reference ?? "");
  if (star) return byId.get(star[0].toUpperCase()) ?? null;
  const repl = REPL_RE.exec(c.reference ?? "");
  if (repl) return byId.get(repl[0].toLowerCase()) ?? null;
  return null;
}

/** AWD storage re-filed under the month it was for, as in the monthly report. */
function awdStorageByMonth(costsByMonth: InventoryInputs["costsByMonth"]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [posted, costs] of Object.entries(costsByMonth)) {
    if (!costs?.billed?.ready) continue;
    for (const c of costs.billed.charges) {
      const effect = awdStorageEffect(c, costs.billed.signed === true);
      if (effect == null) continue;
      const m = storageMonthOf(c, posted);
      out.set(m, (out.get(m) ?? 0) + effect);
    }
  }
  return out;
}

/**
 * Add stock, turnover and per-SKU AWD costs to a monthly report. SKUs that held
 * stock but sold nothing are added as rows too: dead stock is the point.
 */
export function addInventory(report: MonthlyReport, i: InventoryInputs): InventoryReport {
  const today = i.today ?? new Date().toISOString().slice(0, 10);
  const months = report.months.map((m) => m.month);
  const skusByAsin = new Map<string, string[]>();
  for (const [sku, asin] of Object.entries(i.asinBySku)) {
    const a = up(asin);
    skusByAsin.set(a, [...(skusByAsin.get(a) ?? []), up(sku)]);
  }
  const cost = new Map(Object.entries(i.unitCost).map(([s, c]) => [up(s), c]));

  // AWD history is only meaningful with both today's stock and the movements.
  // One month earlier too, so the first month has an opening balance to average.
  const awdEnd =
    i.awdNow && i.awdMovements
      ? reconstructAwdStock(
          i.awdNow,
          i.awdMovements,
          [prevKey(months[0] ?? today.slice(0, 7)), ...months],
          today,
          receivingDates(i.costsByMonth),
        )
      : null;
  const handling = i.awdMovements ? attributeAwdHandling(i.costsByMonth, i.awdMovements) : null;
  const awdStorage = awdStorageByMonth(i.costsByMonth);

  const rowsByMonth = new Map<string, Map<string, SkuMonthRow>>();
  for (const r of report.skus) {
    if (!rowsByMonth.has(r.month)) rowsByMonth.set(r.month, new Map());
    rowsByMonth.get(r.month)!.set(r.sku, r);
  }

  // Which of an ASIN's SKUs owns its ledger stock is decided once, over every
  // month: the one that sold most overall, then one with AWD stock, then one
  // that is not an FBM or parent variant. Deciding month by month gave the
  // stock to an arbitrary sibling in months whose sales were not yet read.
  const soldOverall = new Map<string, number>();
  for (const r of report.skus) soldOverall.set(r.sku, (soldOverall.get(r.sku) ?? 0) + r.unitsSold);

  // AWD bills by the cubic foot but invoices the account, not the SKU, so the
  // month's bill is shared by cubic feet held: units × Amazon's measured cu ft
  // per unit (from the FBA storage report, newest month first; the ASIN's when
  // the SKU has none; the median when neither has been measured).
  const cuftBySku = new Map<string, number>();
  const cuftByAsin = new Map<string, number>();
  for (const r of [...report.skus].sort((a, b) => a.month.localeCompare(b.month))) {
    if (!r.cuftPerUnit) continue;
    cuftBySku.set(r.sku, r.cuftPerUnit);
    if (r.asin) cuftByAsin.set(up(r.asin), r.cuftPerUnit);
  }
  const known = [...cuftBySku.values()].sort((a, b) => a - b);
  const medianCuft = known.length ? known[Math.floor(known.length / 2)] : 1;
  const cuftOf = (sku: string, asin: string | undefined) =>
    cuftBySku.get(sku) ?? (asin ? cuftByAsin.get(up(asin)) : undefined) ?? medianCuft;
  const hasAwd = new Set(Object.keys(i.awdNow ?? {}).map(up));
  const variant = (sku: string) => /FBM$|PARENT/i.test(sku);
  const ownerOf = (candidates: string[]) =>
    [...candidates].sort(
      (x, y) =>
        (soldOverall.get(y) ?? 0) - (soldOverall.get(x) ?? 0) ||
        Number(hasAwd.has(y)) - Number(hasAwd.has(x)) ||
        Number(variant(x)) - Number(variant(y)) ||
        x.localeCompare(y),
    )[0];

  const skus: InventorySkuRow[] = [];
  /** Units shipped and days, per SKU, for the trailing three months. */
  const shippedHistory = new Map<string, Array<{ shipped: number; days: number }>>();
  const outMonths: InventoryMonthSummary[] = [];

  for (const summary of report.months) {
    const m = summary.month;
    const days = daysInMonth(m);
    const existing = rowsByMonth.get(m) ?? new Map<string, SkuMonthRow>();
    const prev = prevKey(m);

    // The ledger is per ASIN; its stock goes to the ASIN's owning SKU (above),
    // or failing any catalogue SKU, to the SKU the ledger filed it under.
    const ledgerBySku = new Map<string, LedgerMonth>();
    const asinOf = new Map<string, string>();
    for (const [asin, byMonth] of Object.entries(i.ledger?.asins ?? {})) {
      const l = byMonth[m];
      if (!l) continue;
      const a = up(asin);
      const candidates = new Set(skusByAsin.get(a) ?? []);
      for (const r of existing.values()) if (up(r.asin) === a) candidates.add(r.sku);
      const sku = ownerOf([...candidates]) ?? up(i.ledger?.mskus?.[asin]?.[0] ?? a);
      const prior = ledgerBySku.get(sku);
      ledgerBySku.set(sku, prior ? addLedger(prior, l) : l);
      asinOf.set(sku, a);
    }

    // Rows for every SKU that sold, or held stock at FBA or AWD this month.
    const all = new Set(existing.keys());
    for (const [sku, l] of ledgerBySku) if (l.start > 0 || l.end > 0 || l.shipments > 0) all.add(sku);
    if (awdEnd) for (const [sku, byMonth] of Object.entries(awdEnd)) if ((byMonth[m] ?? 0) > 0) all.add(sku);

    const awdHeld = new Map<string, number>();
    for (const sku of all) {
      if (!awdEnd?.[sku]) continue;
      const end = awdEnd[sku][m] ?? 0;
      const start = awdEnd[sku][prev] ?? end;
      awdHeld.set(sku, (start + end) / 2);
    }
    const awdCuft = new Map<string, number>();
    for (const [sku, units] of awdHeld) awdCuft.set(sku, units * cuftOf(sku, asinOf.get(sku) ?? existing.get(sku)?.asin ?? i.asinBySku[sku]));
    const awdCuftTotal = sum([...awdCuft.values()]);
    const awdStorageMonth = awdStorage.get(m);
    const agedMonth = i.agedBySku[m];

    const monthRows: InventorySkuRow[] = [];
    for (const sku of all) {
      const base: SkuMonthRow =
        existing.get(sku) ?? {
          month: m, sku, asin: asinOf.get(sku) ?? i.asinBySku[sku] ?? "", productName: i.productNameBySku?.[sku] ?? "", unitsSold: 0, unitsRefunded: 0, netSales: 0,
          fulfilmentFees: 0, fulfilmentPerUnit: null, referralFees: 0, fbaStorage: null, avgUnitsStored: null, cuftPerUnit: null,
          storagePerUnitSold: null, storageShareOfSales: null, costShareOfSales: null,
        };
      const l = ledgerBySku.get(sku);
      const awdE = awdEnd?.[sku]?.[m] ?? (awdEnd ? 0 : null);
      const awdAvg = awdHeld.get(sku) ?? (awdEnd ? 0 : null);
      const fbaAvg = l ? (l.start + l.end) / 2 : null;
      const avgHeld = fbaAvg == null && awdAvg == null ? null : (fbaAvg ?? 0) + (awdAvg ?? 0);
      // The ledger's customer shipments are the units that left stock; they
      // match the balances. Order lines are the fallback for a SKU it lacks.
      const shipped = l ? l.shipments : base.unitsSold || null;
      const c = cost.get(sku) ?? null;
      const endUnits = l || awdE != null ? (l?.end ?? 0) + (awdE ?? 0) : null;
      const h = handling?.bySku[m]?.[sku];
      const aged = agedMonth?.[sku];

      monthRows.push({
        ...base,
        fbaUnitsEnd: l ? l.end : null,
        awdUnitsEnd: awdE,
        avgUnitsHeld: avgHeld != null ? Math.round(avgHeld) : null,
        fbaUnitsAvg: fbaAvg,
        awdUnitsAvg: awdAvg,
        unitsShipped: shipped,
        unitsReceived: l ? l.receipts : null,
        unitCost: c?.cost ?? null,
        costSource: c?.source ?? null,
        inventoryValue: c && endUnits != null ? round(endUnits * c.cost) : null,
        cogsSold: c && shipped != null ? round(shipped * c.cost) : null,
        turnover: avgHeld && avgHeld > 0 && shipped != null ? round((shipped / avgHeld) * (365 / days), 2) : null,
        daysOfInventory: avgHeld != null && shipped && shipped > 0 ? Math.round(avgHeld / (shipped / days)) : null,
        awdProcessing: round(h?.processing ?? 0),
        awdTransport: round(h?.transport ?? 0),
        awdStorage:
          awdStorageMonth != null && awdCuftTotal > 0
            ? round((awdStorageMonth * (awdCuft.get(sku) ?? 0)) / awdCuftTotal)
            : null,
        agedSurcharge: agedMonth ? round(aged?.amount ?? 0) : null,
        agedUnits: agedMonth ? aged?.units ?? 0 : null,
      });
    }
    monthRows.sort((a, b) => b.netSales - a.netSales || (b.inventoryValue ?? 0) - (a.inventoryValue ?? 0));

    // Excess is judged on a trailing 90-day pace, not this month alone: a
    // seasonal SKU in its quiet month would otherwise read as years of stock.
    for (const r of monthRows) {
      const h = [...(shippedHistory.get(r.sku) ?? []), { shipped: r.unitsShipped ?? 0, days }].slice(-3);
      shippedHistory.set(r.sku, h);
    }
    const isExcess = (r: InventorySkuRow) => {
      const h = shippedHistory.get(r.sku) ?? [];
      const shipped = sum(h.map((x) => x.shipped));
      const end = (r.fbaUnitsEnd ?? 0) + (r.awdUnitsEnd ?? 0);
      if (end <= 0) return false;
      if (shipped <= 0) return true;
      return end / (shipped / sum(h.map((x) => x.days))) > EXCESS_DAYS;
    };
    skus.push(...monthRows);

    // Portfolio: money-weighted turnover over the SKUs with a cost.
    const costed = monthRows.filter((r) => r.unitCost != null);
    const heldValue = sum(costed.map((r) => (r.avgUnitsHeld ?? 0) * r.unitCost!));
    const cogsSold = sum(costed.map((r) => r.cogsSold ?? 0));
    const netSales = sum(monthRows.map((r) => r.netSales));
    const costedSales = sum(costed.map((r) => r.netSales));
    const anyLedger = monthRows.some((r) => r.fbaUnitsEnd != null);

    outMonths.push({
      ...summary,
      fbaUnitsEnd: anyLedger ? sum(monthRows.map((r) => r.fbaUnitsEnd ?? 0)) : null,
      awdUnitsEnd: awdEnd ? sum(monthRows.map((r) => r.awdUnitsEnd ?? 0)) : null,
      inventoryValue: costed.length ? round(sum(costed.map((r) => r.inventoryValue ?? 0))) : null,
      cogsSold: costed.length ? round(cogsSold) : null,
      turnover: heldValue > 0 ? round((cogsSold / heldValue) * (365 / days), 2) : null,
      daysOfInventory: cogsSold > 0 ? Math.round(heldValue / (cogsSold / days)) : null,
      costCoverage: netSales > 0 ? round(costedSales / netSales, 4) : null,
      awdUnattributed: round(handling?.unattributed[m] ?? 0),
      agedSurchargeBySku: agedMonth ? round(sum(Object.values(agedMonth).map((a) => a.amount))) : null,
      unitsShipped: anyLedger ? sum(monthRows.map((r) => r.unitsShipped ?? 0)) : null,
      unitsReceived: anyLedger ? sum(monthRows.map((r) => r.unitsReceived ?? 0)) : null,
      fbaUnitsAvg: anyLedger ? round(sum(monthRows.map((r) => r.fbaUnitsAvg ?? 0)), 0) : null,
      awdUnitsAvg: awdEnd ? round(sum(monthRows.map((r) => r.awdUnitsAvg ?? 0)), 0) : null,
      heldValue: costed.length ? round(heldValue) : null,
      excessValue: costed.length
        ? round(sum(costed.filter(isExcess).map((r) => r.inventoryValue ?? 0)))
        : null,
      ...inStockFor(m, i),
      deadValue: costed.length
        ? round(sum(costed.filter((r) => (r.unitsShipped ?? 0) === 0).map((r) => r.inventoryValue ?? 0)))
        : null,
    });
  }

  return { months: outMonths, skus };
}

/**
 * In-stock rate for a month: days with sellable stock over days observed, per
 * ASIN, weighted by its average monthly shipments over the six months to date.
 * The weight is a trailing average on purpose — in the month a SKU runs out its
 * shipments collapse, and weighting by that month would make the stockout
 * count for almost nothing.
 */
function inStockFor(month: string, i: InventoryInputs): { inStockRate: number | null; skusStockedOut: number | null } {
  if (!i.inStock || !i.ledger) return { inStockRate: null, skusStockedOut: null };
  const window = [0, 1, 2, 3, 4, 5].map((k) => shift(month, -k));
  let num = 0;
  let den = 0;
  let out = 0;
  for (const [asin, byMonth] of Object.entries(i.inStock)) {
    const days = byMonth[month];
    if (!days || days[1] === 0) continue;
    const l = i.ledger.asins[asin] ?? i.ledger.asins[up(asin)];
    if (!l) continue;
    const pace = sum(window.map((m) => l[m]?.shipments ?? 0)) / window.length;
    if (pace <= 0) continue;
    const rate = days[0] / days[1];
    num += pace * rate;
    den += pace;
    if (rate < 0.95) out++;
  }
  return den > 0 ? { inStockRate: round(num / den, 4), skusStockedOut: out } : { inStockRate: null, skusStockedOut: null };
}

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addLedger(a: LedgerMonth, b: LedgerMonth): LedgerMonth {
  return {
    start: a.start + b.start,
    end: a.end + b.end,
    end_sellable: a.end_sellable + b.end_sellable,
    receipts: a.receipts + b.receipts,
    shipments: a.shipments + b.shipments,
    returns: a.returns + b.returns,
  };
}

function prevKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
