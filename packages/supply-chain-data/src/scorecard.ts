// Is the supply chain getting better? A short list of measures a supply-chain
// manager actually moves, each judged against a comparison period.
//
// The measures are chosen so volume and price cannot flatter or punish them:
// per unit, per dollar of stock, or as a share — never raw totals, which rise
// with sales whoever runs the warehouse. The default comparison is the same
// months a year earlier, so a seasonal business is not judged against its own
// off-season.
//
// They are also chosen to pull against each other. Cutting stock improves
// turnover and storage cost and worsens availability; any one of them alone
// can be gamed. The balance note says when a gain was bought with stockouts.

import type { InventoryMonthSummary } from "./inventory";
import type { PeriodSummary } from "./periods";
import { likeForLike, pctChange, ppChange } from "./periods";

export type ScoreVerdict = "improving" | "holding" | "worse" | "unknown";

export interface ScoreMeasure {
  key: keyof PeriodSummary & string;
  label: string;
  /** What the manager can do about it, said plainly. */
  lever: string;
  better: 1 | -1;
  change: "pct" | "pp";
  /** Changes smaller than this are "holding": noise, not a trend. */
  tolerance: number;
  /** Partly set by Amazon's rate card or product mix, not only by the manager. */
  partlyExternal?: boolean;
}

export const SCORECARD: ScoreMeasure[] = [
  { key: "inStockRate", label: "In-stock rate", lever: "Reordering and AWD → FBA replenishment in time", better: 1, change: "pp", tolerance: 0.005 },
  { key: "daysOfInventory", label: "Days of inventory", lever: "Order quantities and timing", better: -1, change: "pct", tolerance: 0.05 },
  { key: "turnover", label: "Inventory turnover", lever: "Order quantities and timing", better: 1, change: "pct", tolerance: 0.05 },
  { key: "excessShare", label: "Stock over 180 days cover", lever: "Clearing slow stock; not over-ordering", better: -1, change: "pp", tolerance: 0.02 },
  // Amazon's own figure, from its storage-fee report: stored volume against
  // shipped volume over a trailing window. The period shows its latest month.
  { key: "utilizationWeeks", label: "Storage utilisation ratio (Amazon)", lever: "Stock volume held against what ships", better: -1, change: "pct", tolerance: 0.05 },
  { key: "agedSurcharge", label: "Aged-inventory surcharge", lever: "Removing or promoting stock before 181 days", better: -1, change: "pct", tolerance: 0.1 },
  { key: "controllablePerUnit", label: "Storage & logistics / unit sold", lever: "Stock levels, AWD vs FBA placement, inbound choices", better: -1, change: "pct", tolerance: 0.03 },
  { key: "storageShareOfSales", label: "Storage % of sales", lever: "Stock levels and placement", better: -1, change: "pp", tolerance: 0.001 },
  { key: "awdStoragePerUnitMonth", label: "AWD storage / unit-month", lever: "How long stock waits at AWD", better: -1, change: "pct", tolerance: 0.05 },
  { key: "inboundPerUnitReceived", label: "Inbound cost / unit received", lever: "Placement option, carton and shipment set-up", better: -1, change: "pct", tolerance: 0.05 },
  // Fulfilment fee per unit is left out: Amazon sets the rate card and the size
  // tier follows the product, so it moves without the supply chain moving.
  { key: "gmroi", label: "GMROI", lever: "The outcome of all of the above", better: 1, change: "pct", tolerance: 0.05 },
];

export interface ScoreRow {
  measure: ScoreMeasure;
  current: number | null;
  base: number | null;
  change: number | null;
  verdict: ScoreVerdict;
  /** Set when the measure was compared on only these months (the ones both periods have it). */
  months?: string[];
}

/** Per measure, a like-for-like comparison on fewer months: see likeForLike. */
export type MatchedMeasures = Partial<Record<string, { current: number; base: number; months: string[] }>>;

/** Like-for-like stand-ins for every scorecard measure one side can't give over the whole period. */
export function matchScorecard(
  current: PeriodSummary,
  base: PeriodSummary | null,
  months: InventoryMonthSummary[],
  feeReady: Set<string>,
): MatchedMeasures {
  if (!base) return {};
  const out: MatchedMeasures = {};
  for (const m of SCORECARD) {
    if (current[m.key] != null && base[m.key] != null) continue;
    const r = likeForLike(current, base, months, feeReady, (s) => s[m.key] as number | null);
    if (r) out[m.key] = r;
  }
  return out;
}

export interface Scorecard {
  rows: ScoreRow[];
  improving: number;
  worse: number;
  holding: number;
  measured: number;
  /** Gains that came with a loss of availability, said in words. */
  balance: string | null;
}

export function judge(m: ScoreMeasure, current: number | null, base: number | null): ScoreRow {
  const change = m.change === "pp" ? ppChange(current, base) : pctChange(current, base);
  let verdict: ScoreVerdict = "unknown";
  if (change != null) {
    if (Math.abs(change) < m.tolerance) verdict = "holding";
    else verdict = (change > 0 ? 1 : -1) === m.better ? "improving" : "worse";
  }
  return { measure: m, current, base, change, verdict };
}

export function buildScorecard(current: PeriodSummary, base: PeriodSummary | null, matched: MatchedMeasures = {}): Scorecard {
  const rows = SCORECARD.map((m) => {
    const like = matched[m.key];
    if (like) return { ...judge(m, like.current, like.base), months: like.months };
    return judge(m, current[m.key] as number | null, base ? (base[m.key] as number | null) : null);
  });
  const count = (v: ScoreVerdict) => rows.filter((r) => r.verdict === v).length;
  const v = (k: string) => rows.find((r) => r.measure.key === k)?.verdict;

  let balance: string | null = null;
  const leaner = v("daysOfInventory") === "improving" || v("turnover") === "improving";
  if (leaner && v("inStockRate") === "worse") {
    balance = "Inventory is leaner, but availability fell: part of the gain was paid for in stockouts.";
  } else if (v("inStockRate") === "improving" && (v("daysOfInventory") === "worse" || v("turnover") === "worse")) {
    balance = "Availability improved, but by holding more stock: check the extra cover is earning its storage.";
  } else if (leaner && v("inStockRate") !== "worse" && v("inStockRate") !== "unknown") {
    balance = "Inventory is leaner without losing availability — the gain is real.";
  }

  return {
    rows,
    improving: count("improving"),
    worse: count("worse"),
    holding: count("holding"),
    measured: rows.length - count("unknown"),
    balance,
  };
}
