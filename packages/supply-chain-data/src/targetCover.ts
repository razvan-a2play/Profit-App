// Storage against a days-of-cover target: what holding exactly N days of
// stock would have cost, set against what Amazon charged, in dollars.
//
// For each SKU and month:
//   demand rate   units shipped over the 60 days after mid-month — the second
//                 half of the month, all of the next, the first half of the one
//                 after — so each day is judged against the demand its stock
//                 actually had to meet. Months without that much future yet
//                 fall back to the trailing rate, and say so.
//   target units  rate × target days
//   ideal storage the month's actual FBA + AWD storage, scaled by target units
//                 over units actually held: the same price per unit, the right
//                 quantity. No aged surcharge: stock that turns inside the
//                 target never reaches 181 days.
//   gain / loss   actual − ideal. Above target it is money paid for excess
//                 stock; below target it is storage saved by running thinner
//                 than plan, kept apart so a saving cannot hide an overspend.
//
// Storage is close to linear in volume at these levels (no utilisation
// surcharge has been charged), which is what makes the scaling fair.

import type { InventorySkuRow } from "./inventory";
import { daysInMonth } from "./inventory";

export interface CoverRow {
  month: string;
  sku: string;
  asin: string;
  productName: string;
  /** Average units held in the channel judged (FBA, AWD, or both). */
  unitsHeld: number;
  /** Cubic feet per unit (Amazon's storage measurement), when known. */
  cuftPerUnit: number | null;
  /** What one unit cost to store for the month: storage ÷ units held. Bulkier units cost more. */
  pricePerUnitMonth: number | null;
  /** Cubic feet the stock held took up: units held × cu ft per unit. */
  cuftHeld: number | null;
  /** Cubic feet the target stock would have taken up. */
  cuftTarget: number | null;
  /** What Amazon charged per cubic foot for the month: storage ÷ cubic feet held. */
  ratePerCuft: number | null;
  /** True when running lean was capped at MAX_SCALE × the storage charged. */
  capped: boolean;
  /** False while the SKU's aged surcharge report for the month is unread (counted as $0 meanwhile). */
  agedKnown: boolean;
  /** Units per day the target is sized on. */
  dailyDemand: number;
  /** "forward" (the 60 days that followed) or "trailing" (latest months). */
  demandBasis: "forward" | "trailing";
  targetUnits: number;
  /** Days of cover actually held. Null when nothing shipped. */
  coverDays: number | null;
  actualStorage: number;
  agedSurcharge: number;
  idealStorage: number;
  /** actual + aged − ideal: positive is money lost to excess stock. */
  excessCost: number;
}

export interface CoverMonth {
  month: string;
  skus: number;
  actualStorage: number;
  agedSurcharge: number;
  idealStorage: number;
  /** Paid for stock above the target. */
  overstockCost: number;
  /** The same leaving the aged surcharge out: comparable with months whose aged report is unread. */
  overstockStorage: number;
  /** Every SKU's aged surcharge report has been read. */
  agedKnown: boolean;
  /** Storage saved where stock ran below the target (with the stockout risk that brings). */
  leanSaving: number;
  /** overstockCost − leanSaving. */
  net: number;
  /** Demand-weighted days of cover actually held. */
  coverDays: number | null;
  /** Units per day the month's SKUs were sized on, summed. */
  dailyDemand: number;
  /** Units held and units the target needed, summed over the SKUs judged. */
  unitsHeld: number;
  targetUnits: number;
  /** Cubic feet held and needed, over the SKUs whose cu ft per unit is known. */
  cuftHeld: number;
  cuftTarget: number;
  /** Share of the month's demand on SKUs sized on trailing demand. */
  trailingShare: number;
}

export interface CoverReport {
  targetDays: number;
  channel: CoverChannel;
  months: CoverMonth[];
  rows: CoverRow[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Largest factor the ideal may scale actual storage by (see storageVsTarget). */
export const MAX_SCALE = 4;

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Units per day the target is sized on. Centred: half this month, all of the
 * next, half of the one after. Without that future, the trailing rate over
 * this month and the one before.
 */
export function demandRate(
  shippedBy: Map<string, number>,
  month: string,
  knownMonths: Set<string>,
): { rate: number; basis: "forward" | "trailing" } | null {
  const m1 = shift(month, 1);
  const m2 = shift(month, 2);
  if (knownMonths.has(month) && knownMonths.has(m1) && knownMonths.has(m2)) {
    const units = 0.5 * (shippedBy.get(month) ?? 0) + (shippedBy.get(m1) ?? 0) + 0.5 * (shippedBy.get(m2) ?? 0);
    const days = 0.5 * daysInMonth(month) + daysInMonth(m1) + 0.5 * daysInMonth(m2);
    return { rate: units / days, basis: "forward" };
  }
  const prev = shift(month, -1);
  if (knownMonths.has(month)) {
    const months = knownMonths.has(prev) ? [prev, month] : [month];
    const units = sum(months.map((m) => shippedBy.get(m) ?? 0));
    const days = sum(months.map(daysInMonth));
    return { rate: units / days, basis: "trailing" };
  }
  return null;
}

/**
 * Storage against a days-of-cover target, per SKU-month and per month. Only
 * SKU-months whose FBA storage Amazon itemised are judged: without the
 * storage report there is no price per unit to scale.
 */
/**
 * Which stock and which storage bill are judged:
 *   fba    FBA units against FBA storage, plus the aged surcharge (FBA only)
 *   awd    AWD units against AWD storage
 *   total  both together
 * Demand is the same in every case — what sold — so each channel can carry
 * its own target: say 30 days in FBA and the rest of the cover at AWD.
 */
export type CoverChannel = "fba" | "awd" | "total";

function channelInputs(r: InventorySkuRow, channel: CoverChannel): { held: number; storage: number; aged: number; agedKnown: boolean } | null {
  // FBA units are the average Amazon billed storage on (its storage report),
  // so storage ÷ units is exactly its price per unit: cubic feet × the rate.
  const fbaHeld = r.avgUnitsStored ?? r.fbaUnitsAvg;
  if (channel === "fba") {
    if (r.fbaStorage == null || fbaHeld == null) return null;
    return { held: fbaHeld, storage: r.fbaStorage, aged: r.agedSurcharge ?? 0, agedKnown: r.agedSurcharge != null };
  }
  if (channel === "awd") {
    // AWD storage is invoiced a month in arrears; until then it is unknown, not $0.
    if (r.awdStorage == null || r.awdUnitsAvg == null) return null;
    return { held: r.awdUnitsAvg, storage: r.awdStorage, aged: 0, agedKnown: true };
  }
  if (r.fbaStorage == null || fbaHeld == null) return null;
  return { held: fbaHeld + (r.awdUnitsAvg ?? 0), storage: r.fbaStorage + (r.awdStorage ?? 0), aged: r.agedSurcharge ?? 0, agedKnown: r.agedSurcharge != null };
}

export function storageVsTarget(rows: InventorySkuRow[], targetDays = 60, channel: CoverChannel = "total"): CoverReport {
  // Months with ledger shipments, and each SKU's shipments by month.
  const knownMonths = new Set(rows.filter((r) => r.unitsShipped != null).map((r) => r.month));
  const shipped = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.unitsShipped == null) continue;
    if (!shipped.has(r.sku)) shipped.set(r.sku, new Map());
    shipped.get(r.sku)!.set(r.month, r.unitsShipped);
  }

  const out: CoverRow[] = [];
  for (const r of rows) {
    const input = channelInputs(r, channel);
    if (!input) continue;
    const { storage, aged } = input;
    if (storage <= 0 && aged <= 0) continue;
    const d = demandRate(shipped.get(r.sku) ?? new Map(), r.month, knownMonths);
    if (!d) continue;
    const held = input.held;
    const target = d.rate * targetDays;
    // Nothing held but storage charged (stock that left mid-month): no price
    // per unit to scale, so it is all excess. And a SKU holding a sliver of
    // its target — launching, or out of stock — would scale a noisy price per
    // unit many times over; the ideal is capped at MAX_SCALE × actual.
    const ideal = held > 0 ? storage * Math.min(target / held, MAX_SCALE) : 0;
    const cuft = channel === "awd" ? null : r.cuftPerUnit ?? null;
    const cuftHeld = cuft ? held * cuft : null;
    out.push({
      month: r.month,
      sku: r.sku,
      asin: r.asin,
      productName: r.productName,
      unitsHeld: Math.round(held),
      cuftPerUnit: cuft,
      pricePerUnitMonth: held > 0 ? round(storage / held, 4) : null,
      cuftHeld: cuftHeld != null ? round(cuftHeld, 1) : null,
      cuftTarget: cuft ? round(target * cuft, 1) : null,
      ratePerCuft: cuftHeld ? round(storage / cuftHeld, 3) : null,
      capped: held > 0 && target / held > MAX_SCALE,
      agedKnown: input.agedKnown,
      dailyDemand: round(d.rate, 2),
      demandBasis: d.basis,
      targetUnits: Math.round(target),
      coverDays: d.rate > 0 ? Math.round(held / d.rate) : null,
      actualStorage: round(storage),
      agedSurcharge: round(aged),
      idealStorage: round(ideal),
      excessCost: round(storage + aged - ideal),
    });
  }

  const months = [...new Set(out.map((r) => r.month))].sort();
  return {
    targetDays,
    channel,
    rows: out,
    months: months.map((m) => {
      const rs = out.filter((r) => r.month === m);
      const demand = sum(rs.map((r) => r.dailyDemand));
      const over = sum(rs.filter((r) => r.excessCost > 0).map((r) => r.excessCost));
      const lean = -sum(rs.filter((r) => r.excessCost < 0).map((r) => r.excessCost));
      return {
        month: m,
        skus: rs.length,
        actualStorage: round(sum(rs.map((r) => r.actualStorage))),
        agedSurcharge: round(sum(rs.map((r) => r.agedSurcharge))),
        idealStorage: round(sum(rs.map((r) => r.idealStorage))),
        overstockCost: round(over),
        overstockStorage: round(sum(rs.map((r) => Math.max(r.actualStorage - r.idealStorage, 0)))),
        agedKnown: rs.every((r) => r.agedKnown),
        leanSaving: round(lean),
        net: round(over - lean),
        coverDays: demand > 0 ? Math.round(sum(rs.map((r) => r.unitsHeld)) / demand) : null,
        dailyDemand: round(demand),
        unitsHeld: sum(rs.map((r) => r.unitsHeld)),
        targetUnits: sum(rs.map((r) => r.targetUnits)),
        cuftHeld: round(sum(rs.map((r) => r.cuftHeld ?? 0)), 1),
        cuftTarget: round(sum(rs.map((r) => r.cuftTarget ?? 0)), 1),
        trailingShare: demand > 0 ? round(sum(rs.filter((r) => r.demandBasis === "trailing").map((r) => r.dailyDemand)) / demand, 4) : 0,
      };
    }),
  };
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
