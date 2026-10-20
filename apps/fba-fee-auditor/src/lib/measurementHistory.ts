// Writes a history of Amazon's measured dimensions/weight per SKU to the
// Library's Supabase (table: fba_measurement_snapshots). A new row is appended
// only when Amazon's measurement CHANGED since the last capture (or on first
// capture), so the table reads as a change log — you can see exactly when a
// measurement drifted from your real box.
//
// Writes use the service_role key (bypasses RLS). Defensive: if the table
// doesn't exist yet (migration not applied), returns available:false and writes
// nothing, so the audit never breaks.

import { createClient } from "@supabase/supabase-js";
import type { AuditFinding } from "@platform/calc";
import { getProductLibraryConfig } from "./env";

const TABLE = "fba_measurement_snapshots";
const EPS = 0.02; // inches / lb / $ — ignore floating-point noise when diffing

interface SnapshotRow {
  sku: string;
  asin: string | null;
  report_id: string | null;
  amazon_longest_in: number | null;
  amazon_median_in: number | null;
  amazon_shortest_in: number | null;
  amazon_weight_lb: number | null;
  amazon_size_tier: string | null;
  amazon_fee: number | null;
  our_longest_in: number | null;
  our_median_in: number | null;
  our_shortest_in: number | null;
  our_weight_lb: number | null;
  dims_differ: boolean;
  weight_differ: boolean;
  status: string;
}

export interface HistoryResult {
  /** False when the snapshots table doesn't exist yet. */
  available: boolean;
  /** Number of new snapshot rows written this run. */
  recorded: number;
  /** SKUs whose Amazon measurement changed vs the previous snapshot. */
  changedSkus: string[];
  /** True when there were no prior snapshots (this run is the baseline). */
  baseline: boolean;
}

const near = (a: number | null, b: number | null) => {
  if (a == null || b == null) return a == b; // both null = same; one null = differ
  return Math.abs(a - b) <= EPS;
};

/** Did Amazon's measured values change between two snapshots? */
function amazonChanged(prev: Partial<SnapshotRow>, next: SnapshotRow): boolean {
  return !(
    near(prev.amazon_longest_in ?? null, next.amazon_longest_in) &&
    near(prev.amazon_median_in ?? null, next.amazon_median_in) &&
    near(prev.amazon_shortest_in ?? null, next.amazon_shortest_in) &&
    near(prev.amazon_weight_lb ?? null, next.amazon_weight_lb) &&
    (prev.amazon_size_tier ?? null) === next.amazon_size_tier &&
    near(prev.amazon_fee ?? null, next.amazon_fee)
  );
}

export async function recordSnapshots(
  findings: AuditFinding[],
  reportId: string | null,
): Promise<HistoryResult> {
  const cfg = getProductLibraryConfig();
  if (!cfg) return { available: false, recorded: 0, changedSkus: [], baseline: false };

  const client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Latest snapshot per SKU (fetch recent rows, reduce to first-seen per SKU).
  const { data: existing, error: readErr } = await client
    .from(TABLE)
    .select(
      "sku,amazon_longest_in,amazon_median_in,amazon_shortest_in,amazon_weight_lb,amazon_size_tier,amazon_fee,captured_at",
    )
    .order("captured_at", { ascending: false });

  if (readErr) {
    // Most likely the table doesn't exist yet.
    return { available: false, recorded: 0, changedSkus: [], baseline: false };
  }

  const latestBySku = new Map<string, Partial<SnapshotRow>>();
  for (const row of (existing ?? []) as unknown as (Partial<SnapshotRow> & { sku: string })[]) {
    const key = row.sku.trim().toLowerCase();
    if (!latestBySku.has(key)) latestBySku.set(key, row);
  }
  const baseline = latestBySku.size === 0;

  // Build candidate rows for findings that carry Amazon measurements.
  const toInsert: SnapshotRow[] = [];
  const changedSkus: string[] = [];

  for (const f of findings) {
    if (!f.amazonSides) continue; // no Amazon dimensions to record
    const next: SnapshotRow = {
      sku: f.sku,
      asin: f.asin ?? null,
      report_id: reportId,
      amazon_longest_in: f.amazonSides.longest,
      amazon_median_in: f.amazonSides.median,
      amazon_shortest_in: f.amazonSides.shortest,
      amazon_weight_lb: f.amazonWeightLb ?? null,
      amazon_size_tier: f.amazonTier ?? null,
      amazon_fee: f.amazonFee ?? null,
      our_longest_in: f.realSides?.longest ?? null,
      our_median_in: f.realSides?.median ?? null,
      our_shortest_in: f.realSides?.shortest ?? null,
      our_weight_lb: f.realWeightLb ?? null,
      dims_differ: f.dimsDiffer,
      weight_differ: f.weightDiffer,
      status: f.status,
    };

    // Record an observation every run (so each week accumulates data points to
    // average). Still flag SKUs whose Amazon measurement changed vs last time.
    toInsert.push(next);
    const prev = latestBySku.get(f.sku.trim().toLowerCase());
    if (prev && amazonChanged(prev, next)) changedSkus.push(f.sku);
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await client.from(TABLE).insert(toInsert);
    if (insErr) return { available: false, recorded: 0, changedSkus: [], baseline };
  }

  return { available: true, recorded: toInsert.length, changedSkus, baseline };
}

// ── Per-SKU weekly history ───────────────────────────────────────────────────

export interface WeeklyMeasurement {
  /** ISO date of that week's Monday, e.g. "2026-06-01". */
  weekStart: string;
  /** Number of snapshots observed that week. */
  observations: number;
  /** Weekly AVERAGE of Amazon's measured values. */
  amazonLongestIn: number | null;
  amazonMedianIn: number | null;
  amazonShortestIn: number | null;
  amazonWeightLb: number | null;
  amazonFee: number | null;
  /** Most recent size tier seen that week. */
  amazonSizeTier: string | null;
}

export interface SkuHistory {
  available: boolean;
  sku: string;
  /** Your real box (inches/lb), from the most recent snapshot. */
  ours: { longestIn: number | null; medianIn: number | null; shortestIn: number | null; weightLb: number | null } | null;
  weeks: WeeklyMeasurement[];
}

/** Monday (UTC) of the week containing `iso`, as YYYY-MM-DD. */
function weekStartOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

const avg = (xs: number[]): number | null =>
  xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null;

export async function fetchWeeklyHistory(sku: string): Promise<SkuHistory> {
  const cfg = getProductLibraryConfig();
  if (!cfg) return { available: false, sku, ours: null, weeks: [] };

  const client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client
    .from(TABLE)
    .select(
      "captured_at,amazon_longest_in,amazon_median_in,amazon_shortest_in,amazon_weight_lb,amazon_fee,amazon_size_tier,our_longest_in,our_median_in,our_shortest_in,our_weight_lb",
    )
    .eq("sku", sku)
    .order("captured_at", { ascending: false });

  if (error) return { available: false, sku, ours: null, weeks: [] };

  const rows = (data ?? []) as unknown as (SnapshotRow & { captured_at: string })[];
  if (rows.length === 0) return { available: true, sku, ours: null, weeks: [] };

  const ours = {
    longestIn: rows[0].our_longest_in ?? null,
    medianIn: rows[0].our_median_in ?? null,
    shortestIn: rows[0].our_shortest_in ?? null,
    weightLb: rows[0].our_weight_lb ?? null,
  };

  // Group by week.
  const byWeek = new Map<string, (SnapshotRow & { captured_at: string })[]>();
  for (const r of rows) {
    const wk = weekStartOf(r.captured_at);
    (byWeek.get(wk) ?? byWeek.set(wk, []).get(wk)!).push(r);
  }

  const nums = (rs: (SnapshotRow & { captured_at: string })[], k: keyof SnapshotRow) =>
    rs.map((r) => r[k]).filter((v): v is number => typeof v === "number");

  const weeks: WeeklyMeasurement[] = [...byWeek.entries()]
    .sort((a, b) => b[0].localeCompare(a[0])) // newest week first
    .map(([weekStart, rs]) => ({
      weekStart,
      observations: rs.length,
      amazonLongestIn: avg(nums(rs, "amazon_longest_in")),
      amazonMedianIn: avg(nums(rs, "amazon_median_in")),
      amazonShortestIn: avg(nums(rs, "amazon_shortest_in")),
      amazonWeightLb: avg(nums(rs, "amazon_weight_lb")),
      amazonFee: avg(nums(rs, "amazon_fee")),
      amazonSizeTier: rs[0].amazon_size_tier ?? null, // newest in week
    }));

  return { available: true, sku, ours, weeks };
}
