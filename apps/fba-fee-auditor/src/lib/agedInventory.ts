// Aged inventory: what each bucket is costing, and what it will cost next.
//
// Amazon's aged-inventory surcharge starts at 181 days and steps up sharply —
// a unit that crosses 365 days costs many times what it did at 181. So the
// number that matters is rarely today's bill; it is what the 91-180 bucket
// turns into if nothing sells before it ages over.
//
// THE SURCHARGE IS PRICED PER CUBIC FOOT, NOT PER UNIT. The rates below are
// dollars per cubic foot per month, confirmed against Amazon's own per-SKU
// estimate: $0.51 / $1.00 / $1.50 / ~$5.90 / $7.90 implied across the tiers.
// Applying them per unit overstated this catalogue's bill by 10x ($548 against
// Amazon's own $52), because these are small toys — a tenth of a cubic foot
// each. So the charge is taken from Amazon's figure and never re-derived; the
// rate is used only to project the bucket that is not being charged yet.

import type { AgedRow } from "./amazonInventory";

/** $ per cubic foot per month, by tier. */
export const LTSF_RATE_181_270 = 0.5;
export const LTSF_RATE_271_330 = 1.4;
export const LTSF_RATE_331_365 = 4.3;
export const LTSF_RATE_365_PLUS = 6.9;
/** The tier a unit lands in the month it crosses 181 days. */
export const AIS_ENTRY_RATE_PER_CUFT = 0.5;

export interface AgedSku {
  sku: string;
  asin: string | null;
  productName: string | null;
  yourPrice: number | null;
  age0_90: number;
  age91_180: number;
  age181_270: number;
  age271_330: number;
  age331_365: number;
  age365Plus: number;
  totalUnits: number;
  /** Units already past 181 days. */
  activeUnits: number;
  /** Units aged 91-180 — nothing owed yet, but next in line. */
  riskUnits: number;
  /** Amazon's own estimate of next month's surcharge for this SKU. */
  monthlyLtsf: number;
  /** Units Amazon will charge at the next charge date. */
  chargedUnits: number;
  /**
   * Units under 181 days today that Amazon says will be charged next time —
   * i.e. the ones actually tipping into a threshold. Amazon's forecast, not
   * ours: chargedUnits minus what is already aged.
   */
  crossingUnits: number;
  /** Units sold in the last 30 / 90 days, to judge whether they clear first. */
  unitsShippedT30: number;
  unitsShippedT90: number;
  daysOfSupply: number | null;
  /**
   * Days to sell the crossing units at the faster of the two recent rates.
   * Null when nothing is crossing or the SKU has no sales to measure.
   */
  daysToClearCrossing: number | null;
  /** Cubic feet per unit. */
  itemVolumeCuFt: number | null;
  /**
   * What the 91-180 bucket starts costing once it crosses 181 days:
   * units x cubic feet x the entry rate. Null when Amazon gives no volume,
   * because a per-unit guess would be wrong by an order of magnitude.
   */
  projectedMonthlyLtsf: number | null;
  /** Retail value of the aged units — what removal or liquidation gives up. */
  agedRetailValue: number;
  /** The oldest bucket carrying units, for sorting and display. */
  oldestBucket: string | null;
}

/** Days to shift `units` at `perDay`, or null when the question is moot. */
function daysToClear(units: number, perDay: number): number | null {
  if (units <= 0 || perDay <= 0) return null;
  return Math.round((units / perDay) * 10) / 10;
}

export interface AgedTotals {
  skus: number;
  age0_90: number;
  age91_180: number;
  age181_270: number;
  age271_330: number;
  age331_365: number;
  age365Plus: number;
  totalUnits: number;
  activeUnits: number;
  riskUnits: number;
  monthlyLtsf: number;
  annualLtsf: number;
  projectedMonthlyLtsf: number;
  chargedUnits: number;
  crossingUnits: number;
  agedRetailValue: number;
}

const BUCKETS: [keyof AgedRow, string][] = [
  ["age365Plus", "365+ days"],
  ["age331_365", "331-365 days"],
  ["age271_330", "271-330 days"],
  ["age181_270", "181-270 days"],
  ["age91_180", "91-180 days"],
  ["age0_90", "0-90 days"],
];

export function toAgedSku(r: AgedRow): AgedSku {
  const activeUnits = r.age181_270 + r.age271_330 + r.age331_365 + r.age365Plus;
  const price = r.yourPrice ?? 0;
  const vol = r.itemVolumeCuFt ?? null;
  return {
    sku: r.sku,
    asin: r.asin,
    productName: r.productName,
    yourPrice: r.yourPrice,
    age0_90: r.age0_90,
    age91_180: r.age91_180,
    age181_270: r.age181_270,
    age271_330: r.age271_330,
    age331_365: r.age331_365,
    age365Plus: r.age365Plus,
    totalUnits: r.totalUnits,
    activeUnits,
    riskUnits: r.age91_180,
    // Amazon's own number. Never recomputed — see the note at the top.
    monthlyLtsf: round2(r.aisMonthly),
    chargedUnits: r.aisUnits,
    crossingUnits: Math.max(0, r.aisUnits - activeUnits),
    unitsShippedT30: r.unitsShippedT30,
    unitsShippedT90: r.unitsShippedT90,
    daysOfSupply: r.daysOfSupply,
    // Take the better of the two windows: a SKU that has picked up recently
    // should not be judged on a quarter of slow weeks, or the reverse.
    daysToClearCrossing: daysToClear(
      Math.max(0, r.aisUnits - activeUnits),
      Math.max(r.unitsShippedT30 / 30, r.unitsShippedT90 / 90),
    ),
    itemVolumeCuFt: vol,
    // The 91-180 bucket lands in the 181-210 tier first, so that is the rate
    // it starts at — applied to its VOLUME, which is how Amazon charges.
    projectedMonthlyLtsf:
      vol != null && vol > 0 ? round2(r.age91_180 * vol * AIS_ENTRY_RATE_PER_CUFT) : null,
    agedRetailValue: round2(activeUnits * price),
    oldestBucket: BUCKETS.find(([k]) => (r[k] as number) > 0)?.[1] ?? null,
  };
}

/** Aged first, then by what it costs. A SKU paying nothing sorts last. */
export function rankAged(rows: AgedSku[]): AgedSku[] {
  return [...rows].sort(
    (a, b) =>
      b.monthlyLtsf - a.monthlyLtsf ||
      (b.projectedMonthlyLtsf ?? 0) - (a.projectedMonthlyLtsf ?? 0) ||
      b.totalUnits - a.totalUnits,
  );
}

export function totalAged(rows: AgedSku[]): AgedTotals {
  const sum = (f: (r: AgedSku) => number) => rows.reduce((t, r) => t + f(r), 0);
  const monthly = round2(sum((r) => r.monthlyLtsf));
  return {
    skus: rows.length,
    age0_90: sum((r) => r.age0_90),
    age91_180: sum((r) => r.age91_180),
    age181_270: sum((r) => r.age181_270),
    age271_330: sum((r) => r.age271_330),
    age331_365: sum((r) => r.age331_365),
    age365Plus: sum((r) => r.age365Plus),
    totalUnits: sum((r) => r.totalUnits),
    activeUnits: sum((r) => r.activeUnits),
    riskUnits: sum((r) => r.riskUnits),
    monthlyLtsf: monthly,
    annualLtsf: round2(monthly * 12),
    projectedMonthlyLtsf: round2(sum((r) => r.projectedMonthlyLtsf ?? 0)),
    chargedUnits: sum((r) => r.chargedUnits),
    crossingUnits: sum((r) => r.crossingUnits),
    agedRetailValue: round2(sum((r) => r.agedRetailValue)),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
