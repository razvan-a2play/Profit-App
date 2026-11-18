// Dated Amazon US FBA fee schedules for the P&L calculator.
//
// Amazon reprices FBA every year (usually Jan 15). Each schedule here is one
// published rate card, with every selling-price column Amazon prints:
//   under $10 (Low-Price FBA)  ->  FbaFeeRow.lowPrice  / peakLowPrice
//   $10 - $50                  ->  FbaFeeRow.nonPeak   / peak
//   over $50                   ->  FbaFeeRow.highPrice / peakHighPrice
// calculateFBATierAndFee picks the column from the selling price, so there is
// no separate "low-price discount" to apply on top.
//
// A schedule with status "pending" has no rates yet; resolveFeeSchedule never
// returns one, it falls back to the newest schedule that has rates.

import type { FbaFeeRow, FeeTableOverride, SizeTier } from "./fbaFees";

export type FeeScheduleId = "us-2026" | "us-2027";

export interface FeeSchedule {
  id: FeeScheduleId;
  /** "2026 rates" */
  label: string;
  /** First day the rates apply, ISO date (Amazon's effective date). */
  effectiveFrom: string;
  /** "ready": rates entered. "pending": announced, rates not entered yet. */
  status: "ready" | "pending";
  /**
   * Fuel and logistics surcharge, as a fraction of the fulfilment fee
   * (0.035 = 3.5%). Amazon adds it to the fulfilment fee, then takes the SIPP
   * discount off the surcharged amount.
   */
  fuelSurchargeRate: number;
  /** Fee rows + size tiers. null while status is "pending". */
  table: FeeTableOverride | null;
  /** Where the figures came from, and anything estimated. Shown in the UI. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

const UNIT = "Unit weight";
const GREATER = "Greater of unit or dimensional weight";

/**
 * [weight band, <$10, $10-50, >$50, peak <$10, peak $10-50, peak >$50]
 */
type StandardBand = readonly [string, number, number, number, number, number, number];

function standardRows(tier: string, weightBasis: string, bands: ReadonlyArray<StandardBand>): FbaFeeRow[] {
  return bands.map(([weightRange, low, mid, high, pLow, pMid, pHigh]) => ({
    tier,
    weightRange,
    weightBasis,
    lowPrice: low,
    nonPeak: mid,
    highPrice: high,
    peakLowPrice: pLow,
    peak: pMid,
    peakHighPrice: pHigh,
  }));
}

/**
 * Bulky and extra-large: base + surcharge per interval above a threshold.
 * Amazon prints one figure for $10+ (the $10-$50 and over-$50 columns are
 * equal), so highPrice = nonPeak.
 * [weight band, <$10, $10+, peak <$10, peak $10+, $ per interval, interval lb, above lb]
 */
type FormulaBand = readonly [string, number, number, number, number, number, number, number];

function formulaRows(tier: string, bands: ReadonlyArray<FormulaBand>): FbaFeeRow[] {
  return bands.map(([weightRange, low, mid, pLow, pMid, perInterval, intervalLb, aboveLb]) => ({
    tier,
    weightRange,
    weightBasis: GREATER,
    lowPrice: low,
    nonPeak: mid,
    highPrice: mid,
    peakLowPrice: pLow,
    peak: pMid,
    peakHighPrice: pMid,
    surchargePerInterval: perInterval,
    surchargeIntervalLb: intervalLb,
    surchargeAboveLb: aboveLb,
  }));
}

// ---------------------------------------------------------------------------
// US 2026 - effective Jan 15, 2026 (fuel surcharge from Apr 17, 2026)
//
// Source: Amazon's official 2026 US rate card, pasted from Seller Central
// into the FBA Fee Auditor on Sep 15, 2026 (apps/fba-fee-auditor/.data/
// rate-card.json). Every fee row, peak column and packaging-fee row below
// was diffed against it and matches.
//
// Checked against Amazon's own per-SKU expected fulfillment fee (Fee
// Auditor's GET_FBA_ESTIMATED_FBA_FEES report, Sep 15, 2026): rate +
// 3.5% surcharge - SIPP reproduces Amazon's figure to the cent, e.g.
// SEZ0101011 = (6.97 + 2 x 0.08) x 1.035 - 0.23 = $7.15.
// ---------------------------------------------------------------------------

const US_2026_SMALL_STANDARD: ReadonlyArray<StandardBand> = [
  ["2 oz or less", 2.43, 3.32, 3.58, 2.62, 3.51, 3.77],
  ["2+ to 4 oz", 2.49, 3.42, 3.68, 2.68, 3.61, 3.87],
  ["4+ to 6 oz", 2.56, 3.45, 3.71, 2.76, 3.65, 3.91],
  ["6+ to 8 oz", 2.66, 3.54, 3.8, 2.86, 3.74, 4.0],
  ["8+ to 10 oz", 2.77, 3.68, 3.94, 2.98, 3.89, 4.15],
  ["10+ to 12 oz", 2.82, 3.78, 4.04, 3.03, 3.99, 4.25],
  ["12+ to 14 oz", 2.92, 3.91, 4.17, 3.14, 4.13, 4.39],
  ["14+ to 16 oz", 2.95, 3.96, 4.22, 3.17, 4.18, 4.44],
];

const US_2026_LARGE_STANDARD: ReadonlyArray<StandardBand> = [
  ["4 oz or less", 2.91, 3.73, 3.99, 3.15, 3.97, 4.23],
  ["4+ to 8 oz", 3.13, 3.95, 4.21, 3.39, 4.21, 4.47],
  ["8+ to 12 oz", 3.38, 4.2, 4.46, 3.66, 4.48, 4.74],
  ["12+ to 16 oz", 3.78, 4.6, 4.86, 4.07, 4.89, 5.15],
  ["1+ to 1.25 lb", 4.22, 5.04, 5.3, 4.52, 5.34, 5.6],
  ["1.25+ to 1.5 lb", 4.6, 5.42, 5.68, 4.91, 5.73, 5.99],
  ["1.5+ to 1.75 lb", 4.75, 5.57, 5.83, 5.07, 5.89, 6.15],
  ["1.75+ to 2 lb", 5.0, 5.82, 6.08, 5.33, 6.15, 6.41],
  ["2+ to 2.25 lb", 5.1, 5.92, 6.18, 5.47, 6.29, 6.55],
  ["2.25+ to 2.5 lb", 5.28, 6.1, 6.36, 5.67, 6.49, 6.75],
  ["2.5+ to 2.75 lb", 5.44, 6.26, 6.52, 5.84, 6.66, 6.92],
  ["2.75+ to 3 lb", 5.85, 6.67, 6.93, 6.26, 7.08, 7.34],
];

/** Large standard 3+ to 20 lb: base + $0.08 per 4 oz above the first 3 lb. */
const US_2026_LARGE_STANDARD_HEAVY: FbaFeeRow = {
  tier: "large standard",
  weightRange: "3+ to 20 lb",
  weightBasis: GREATER,
  lowPrice: 6.15,
  nonPeak: 6.97,
  highPrice: 7.23,
  peakLowPrice: 6.69,
  peak: 7.51,
  peakHighPrice: 7.77,
  surchargePerInterval: 0.08,
  surchargeIntervalLb: 0.25,
  surchargeAboveLb: 3,
};

// Bulky rows use an open lower band ("0+ lb") so a unit whose DIMENSIONAL
// weight passes 50 lb still gets the bulky formula rather than $0.
const US_2026_REGULAR: FbaFeeRow[] = [
  ...standardRows("small standard", UNIT, US_2026_SMALL_STANDARD),
  ...standardRows("large standard", GREATER, US_2026_LARGE_STANDARD),
  US_2026_LARGE_STANDARD_HEAVY,
  ...formulaRows("small bulky", [["0+ lb", 6.78, 7.55, 7.82, 8.59, 0.38, 1, 1]]),
  ...formulaRows("large bulky", [["0+ lb", 8.58, 9.35, 9.62, 10.39, 0.38, 1, 1]]),
  ...formulaRows("extra-large", [
    ["0 to 50 lb", 25.56, 26.33, 28.29, 29.06, 0.38, 1, 1],
    ["50+ to 70 lb", 36.55, 37.32, 39.36, 40.13, 0.75, 1, 51],
    ["70+ to 150 lb", 50.55, 51.32, 54.97, 55.74, 0.75, 1, 71],
    ["150+ lb", 194.18, 194.95, 202.69, 203.46, 0.19, 1, 151],
  ]),
];

// Dangerous goods (hazmat), same columns as the regular table.
const US_2026_HAZMAT: FbaFeeRow[] = [
  ...standardRows("small standard", UNIT, [
    ["2 oz or less", 3.4, 4.29, 4.55, 3.74, 4.63, 4.89],
    ["2+ to 4 oz", 3.43, 4.36, 4.62, 3.8, 4.73, 4.99],
    ["4+ to 6 oz", 3.48, 4.37, 4.63, 3.88, 4.77, 5.03],
    ["6+ to 8 oz", 3.55, 4.43, 4.69, 3.98, 4.86, 5.12],
    ["8+ to 10 oz", 3.64, 4.55, 4.81, 4.1, 5.01, 5.27],
    ["10+ to 12 oz", 3.65, 4.61, 4.87, 4.14, 5.1, 5.36],
    ["12+ to 14 oz", 3.73, 4.72, 4.98, 4.25, 5.24, 5.5],
    ["14+ to 16 oz", 3.77, 4.78, 5.04, 4.32, 5.33, 5.59],
  ]),
  ...standardRows("large standard", GREATER, [
    ["4 oz or less", 3.73, 4.55, 4.81, 4.32, 5.14, 5.4],
    ["4+ to 8 oz", 3.94, 4.76, 5.02, 4.56, 5.38, 5.64],
    ["8+ to 12 oz", 4.17, 4.99, 5.25, 4.82, 5.64, 5.9],
    ["12+ to 16 oz", 4.37, 5.19, 5.45, 5.04, 5.86, 6.12],
    ["1+ to 1.25 lb", 4.82, 5.64, 5.9, 5.51, 6.33, 6.59],
    ["1.25+ to 1.5 lb", 5.2, 6.02, 6.28, 5.91, 6.73, 6.99],
    ["1.5+ to 1.75 lb", 5.35, 6.17, 6.43, 6.08, 6.9, 7.16],
    ["1.75+ to 2 lb", 5.49, 6.31, 6.57, 6.24, 7.06, 7.32],
    ["2+ to 2.25 lb", 5.56, 6.38, 6.64, 6.33, 7.15, 7.41],
    ["2.25+ to 2.5 lb", 5.74, 6.56, 6.82, 6.53, 7.35, 7.61],
    ["2.5+ to 2.75 lb", 5.9, 6.72, 6.98, 6.7, 7.52, 7.78],
    ["2.75+ to 3 lb", 6.31, 7.13, 7.39, 7.12, 7.94, 8.2],
  ]),
  {
    ...US_2026_LARGE_STANDARD_HEAVY,
    lowPrice: 6.61,
    nonPeak: 7.43,
    highPrice: 7.69,
    peakLowPrice: 7.51,
    peak: 8.33,
    peakHighPrice: 8.59,
  },
  ...formulaRows("small bulky", [["0+ lb", 7.5, 8.27, 9.06, 9.83, 0.38, 1, 1]]),
  ...formulaRows("large bulky", [["0+ lb", 9.3, 10.07, 10.86, 11.63, 0.38, 1, 1]]),
  ...formulaRows("extra-large", [
    ["0 to 50 lb", 27.67, 28.44, 31.71, 32.48, 0.38, 1, 1],
    ["50+ to 70 lb", 39.76, 40.53, 43.86, 44.63, 0.75, 1, 51],
    ["70+ to 150 lb", 57.68, 58.45, 64.04, 64.81, 0.75, 1, 71],
    ["150+ lb", 218.76, 219.53, 230.84, 231.61, 0.19, 1, 151],
  ]),
];

/**
 * Packaging fee on bulky units that are NOT SIPP-certified (since Jan 15,
 * 2026), sized by dimensional weight. Same figure for small and large bulky.
 */
const US_2026_NON_SIPP_PACKAGING: FbaFeeRow[] = (
  [
    ["0+ to 5 lb", 1.51],
    ["5+ to 10 lb", 1.68],
    ["10+ to 15 lb", 1.97],
    ["15+ to 20 lb", 2.6],
    ["20+ to 25 lb", 2.92],
    ["25+ to 30 lb", 3.47],
    ["30+ to 35 lb", 3.6],
    ["35+ to 40 lb", 3.78],
    ["40+ to 45 lb", 3.8],
    ["45+ lb", 4.04],
  ] as const
).flatMap(([weightRange, fee]) =>
  ["small bulky", "large bulky"].map((tier) => ({
    tier,
    weightRange,
    nonPeak: fee,
    peak: fee,
    weightBasis: "Dimensional weight",
  })),
);

const US_2026_SIZE_TIERS: ReadonlyArray<SizeTier> = [
  { name: "Small standard", maxWeight: 1, maxLongest: 15, maxMedian: 12, maxShortest: 0.75, maxLPG: null, weightBasis: UNIT },
  { name: "Large standard", maxWeight: 20, maxLongest: 18, maxMedian: 14, maxShortest: 8, maxLPG: null, weightBasis: GREATER },
  { name: "Small bulky", maxWeight: 50, maxLongest: 37, maxMedian: 28, maxShortest: 20, maxLPG: 130, weightBasis: GREATER },
  { name: "Large bulky", maxWeight: 50, maxLongest: 59, maxMedian: 33, maxShortest: 33, maxLPG: 130, weightBasis: GREATER },
  { name: "Extra-large", maxWeight: null, maxLongest: null, maxMedian: null, maxShortest: null, maxLPG: null, weightBasis: GREATER },
];

export const US_2026: FeeSchedule = {
  id: "us-2026",
  label: "2026 rates",
  effectiveFrom: "2026-01-15",
  status: "ready",
  fuelSurchargeRate: 0.035,
  table: {
    regular: US_2026_REGULAR,
    hazmat: US_2026_HAZMAT,
    sizeTiers: US_2026_SIZE_TIERS,
    // SIPP discounts: the built-in table (BUILT_IN_SIPP_DISCOUNTS) already
    // matches the 2026 card row for row, so none is set here.
    nonSippPackaging: US_2026_NON_SIPP_PACKAGING,
  },
  notes: [
    "Amazon's 2026 US rate card (effective Jan 15, 2026): all three price columns, non-peak and holiday peak.",
    "3.5% fuel and logistics surcharge (since Apr 17, 2026) is added to the fulfillment fee; SIPP comes off after it.",
    "Bulky units that aren't SIPP-certified pay Amazon's packaging fee.",
  ],
};

// ---------------------------------------------------------------------------
// US 2027 - effective Jan 15, 2027. Rates to be entered.
// ---------------------------------------------------------------------------

export const US_2027: FeeSchedule = {
  id: "us-2027",
  label: "2027 rates",
  effectiveFrom: "2027-01-15",
  status: "pending",
  fuelSurchargeRate: 0.035,
  table: null,
  notes: ["Announced Nov 5, 2026. Rates not entered yet."],
};

export const FEE_SCHEDULES: ReadonlyArray<FeeSchedule> = [US_2026, US_2027];

export type FeeScheduleChoice = "auto" | FeeScheduleId;

export interface ResolvedFeeSchedule {
  schedule: FeeSchedule;
  /** What was asked for. */
  choice: FeeScheduleChoice;
  /**
   * Set when the asked-for schedule couldn't be used (rates pending), so the
   * UI can say which rates are really being shown.
   */
  fellBackFrom?: FeeSchedule;
}

/** Local calendar date as YYYY-MM-DD, to compare with effectiveFrom. */
function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The schedule Amazon is charging on `today`, ignoring pending ones. */
export function scheduleInEffect(today: Date = new Date()): FeeSchedule {
  const day = isoDay(today);
  const ready = FEE_SCHEDULES.filter((s) => s.status === "ready");
  const live = ready.filter((s) => s.effectiveFrom <= day);
  return (live.length ? live : ready).reduce((a, b) => (b.effectiveFrom > a.effectiveFrom ? b : a));
}

export function resolveFeeSchedule(choice: FeeScheduleChoice, today: Date = new Date()): ResolvedFeeSchedule {
  const current = scheduleInEffect(today);
  if (choice === "auto") {
    // Past an effective date whose rates aren't entered yet: say so.
    const day = isoDay(today);
    const due = FEE_SCHEDULES.filter((s) => s.effectiveFrom <= day).reduce<FeeSchedule | null>(
      (a, b) => (!a || b.effectiveFrom > a.effectiveFrom ? b : a),
      null,
    );
    return due && due.status === "pending"
      ? { schedule: current, choice, fellBackFrom: due }
      : { schedule: current, choice };
  }
  const asked = FEE_SCHEDULES.find((s) => s.id === choice);
  if (!asked) return { schedule: current, choice };
  if (asked.status === "pending") return { schedule: current, choice, fellBackFrom: asked };
  return { schedule: asked, choice };
}

export type PriceBand = "low" | "mid" | "high";

/** Which of Amazon's price columns a selling price falls in. */
export function priceBandOf(sellingPrice: number): PriceBand {
  if (sellingPrice > 0 && sellingPrice < 10) return "low";
  if (sellingPrice > 50) return "high";
  return "mid";
}

export const PRICE_BAND_LABEL: Record<PriceBand, string> = {
  low: "Under $10",
  mid: "$10–$50",
  high: "Over $50",
};
