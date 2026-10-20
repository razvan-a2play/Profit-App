// Storage and logistics costs: what Amazon charges to hold and move your stock,
// as opposed to the per-unit fulfilment fee the fee audit checks.
//
// Three sources, all SP-API:
//   - GET_FBA_STORAGE_FEE_CHARGES_DATA   FBA storage per SKU, per month, with
//                                        the storage utilisation ratio
//   - GET_FBA_INVENTORY_PLANNING_DATA    sell-through, days of cover, volume
//   - Finances listFinancialEvents       what was actually BILLED, including
//                                        the three AWD charges
//
// The storage report is an estimate Amazon publishes during the month; the
// finance events are the invoice. Both are kept, because the gap between them
// is itself worth seeing.

import type { Gateway } from "./gateway";

// ── storage fees ───────────────────────────────────────────────────────────

export interface StorageSkuRow {
  asin: string;
  fnsku: string;
  product_name: string;
  month: string;
  country: string;
  currency: string;
  size_tier: string;
  item_volume_cuft: number;
  utilization_ratio_weeks: number;
  base_rate: number;
  surcharge_rate: number;
  avg_units: number;
  total_volume_cuft: number;
  base_fee: number;
  surcharge_fee: number;
  fee: number;
  incentive_discount: number;
  fee_per_unit: number | null;
  fulfillment_centers: number;
  volume_units: string;
}

export interface StorageTotals {
  fee: number;
  base_fee: number;
  surcharge_fee: number;
  incentive_discount: number;
  volume: number;
  volume_units: string;
  currency: string;
  utilization_ratio_weeks: number;
  skus: number;
}

export interface StorageFeeResult {
  ready: boolean;
  status?: string;
  error?: string;
  months?: string[];
  country?: string;
  totals?: StorageTotals;
  by_country?: Record<string, StorageTotals>;
  rows: StorageSkuRow[];
}

/** First and last instant of a month, as Amazon wants them. */
export function monthWindow(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Request the storage-fee report for one month. The window is explicit on
 * purpose: asked for without one, Amazon defaults both ends to "now", which
 * names an empty period, and cancels the report.
 */
export async function requestStorageReport(gw: Gateway, month: string): Promise<string | null> {
  const { start, end } = monthWindow(month);
  const out = await gw(
    `/reports/?report_type=GET_FBA_STORAGE_FEE_CHARGES_DATA` +
      `&data_start_time=${encodeURIComponent(start)}&data_end_time=${encodeURIComponent(end)}`,
    { method: "POST" },
  );
  return (out.reportId as string) ?? null;
}

export async function fetchStorageFees(gw: Gateway, reportId: string): Promise<StorageFeeResult> {
  const out = await gw(`/reports/${encodeURIComponent(reportId)}/storage-fees`);
  return { rows: [], ...out } as StorageFeeResult;
}

/** The newest finished storage report, so a month already pulled isn't re-run. */
export interface StorageReportLookup {
  /** A finished report for the month, if Amazon has one. */
  reportId: string | null;
  /** True when every attempt at this month was cancelled — see `cancelled`. */
  cancelled: boolean;
  /** A report still being generated, so nothing new should be requested. */
  pending: string | null;
}

/**
 * Find an existing storage report for a month rather than asking for another.
 * Amazon rate-limits report generation hard, and a month already pulled never
 * changes.
 *
 * A month Amazon hasn't published yet comes back CANCELLED however often it is
 * asked for — storage fees for a month aren't final until partway through the
 * next one — so that case is reported rather than retried forever.
 */
export async function findStorageReport(gw: Gateway, month: string): Promise<StorageReportLookup> {
  const list = (await gw(
    `/reports/?report_type=GET_FBA_STORAGE_FEE_CHARGES_DATA`,
  )) as Array<{ reportId: string; processingStatus?: string; dataStartTime?: string }>;
  const wanted = monthWindow(month).start.slice(0, 7);
  const mine = (Array.isArray(list) ? list : []).filter(
    (r) => (r.dataStartTime ?? "").slice(0, 7) === wanted,
  );
  const done = mine.find((r) => r.processingStatus === "DONE");
  const pending = mine.find((r) => r.processingStatus === "IN_QUEUE" || r.processingStatus === "IN_PROGRESS");
  return {
    reportId: done?.reportId ?? null,
    pending: pending?.reportId ?? null,
    cancelled: !done && !pending && mine.length > 0 && mine.every((r) => r.processingStatus === "CANCELLED"),
  };
}

// ── billed fees ────────────────────────────────────────────────────────────

export type FeeGroup =
  | "fba_storage"
  | "fba_inbound"
  | "fba_removal"
  | "awd_storage"
  | "awd_receiving"
  | "awd_transportation"
  | "marketing"
  | "overhead"
  | "other";

export interface BilledCharge {
  fee_type: string;
  description: string;
  group: FeeGroup;
  amount: number;
  currency: string | null;
  /** The AWD shipment or replenishment order the charge belongs to, when there is one. */
  reference: string;
  /** Marketplace the charge was billed in (from its currency). Older copies lack it; read the currency then. */
  marketplace?: string;
  posted_date: string | null;
}

export interface BilledFees {
  ready: boolean;
  /** "scanning" while the gateway pages Amazon in the background; "failed" if it gave up. */
  status?: "scanning" | "failed";
  error?: string;
  cached?: boolean;
  pages: number;
  total: number;
  by_group: Partial<Record<FeeGroup, number>>;
  by_type: Array<{ fee_type: string; description: string; group: FeeGroup; amount: number; count: number }>;
  /** Fee types the gateway has no label for — named so a new charge is a question, not a silent "other". */
  unrecognised_fee_types: string[];
  charges: BilledCharge[];
  /**
   * Sales and order-level fees per SKU for the window, read from the same scan.
   * Missing from months the gateway cached before it collected them.
   */
  by_sku?: Record<string, SkuMonthSales>;
  /**
   * False when this month's storage charges cannot be trusted (a source that
   * leaves them out or mislabels them): the month it invoices storage for then
   * reads as unknown rather than as $0.
   */
  storageKnown?: boolean;
  /** Every marketplace in its own currency (US, CA, MX). Top-level totals are the US alone. */
  by_market?: Record<string, MarketFees>;
  /** Charges keep their sign: a refund or reversal is a negative cost. Older gateway copies have every amount positive. */
  signed?: boolean;
  /** An older copy served while the gateway re-reads the month. */
  superseded?: boolean;
  /** Where the month came from, when not Amazon's finance API. */
  source?: "amazon" | "helium";
}

/**
 * by_sku key for a month known only in total (no per-SKU detail). Counted in
 * the portfolio figures, never listed as a product.
 */
export const ACCOUNT_LEVEL_SKU = "__ACCOUNT__";

export interface MarketFees {
  total: number;
  by_group: Partial<Record<FeeGroup, number>>;
  by_type: BilledFees["by_type"];
  currency: string | null;
  by_sku: Record<string, SkuMonthSales>;
}

export type Marketplace = "US" | "CA";

const MARKET_BY_CURRENCY: Record<string, string> = { USD: "US", CAD: "CA", MXN: "MX" };

/** A charge's marketplace: tagged by the gateway, or read from its currency in older copies. */
export function chargeMarket(c: BilledCharge): string {
  return c.marketplace ?? MARKET_BY_CURRENCY[c.currency ?? ""] ?? "US";
}

/**
 * One marketplace's slice of a month's fees: its charges, totals and sales
 * per SKU, in its own currency. A copy read before the gateway split sales by
 * marketplace has only the combined figure: the US keeps it (as before), and
 * Canada reports its sales as not yet read rather than borrowing the US total.
 */
export function billedForMarket(b: BilledFees, market: Marketplace): BilledFees {
  const charges = (b.charges ?? []).filter((c) => chargeMarket(c) === market);
  const m = b.by_market?.[market];
  const by_group: BilledFees["by_group"] = {};
  for (const c of charges) by_group[c.group] = (by_group[c.group] ?? 0) + c.amount;
  return {
    ...b,
    charges,
    total: m?.total ?? charges.reduce((a, c) => a + c.amount, 0),
    by_group: m?.by_group ?? by_group,
    by_type: m?.by_type ?? b.by_type.filter(() => market === "US"),
    by_sku: m?.by_sku ?? (market === "US" ? b.by_sku : undefined),
  };
}

/** One marketplace's rows of the storage-fee report, with its own totals. */
export function storageForMarket(s: StorageFeeResult, market: Marketplace): StorageFeeResult {
  const rows = s.rows.filter((r) => (r.country ? r.country.toUpperCase() : "US") === market);
  return { ...s, rows, totals: s.by_country?.[market] ?? (market === "US" ? s.totals : undefined) };
}

export interface SkuMonthSales {
  units_sold: number;
  units_refunded: number;
  /** Item principal on orders posted in the window, before refunds. */
  sales: number;
  /** Principal refunded in the window, as a positive number. */
  refunds: number;
  /** Net cost per fee type (FBAPerUnitFulfillmentFee, Commission, ...), refunds netted off. */
  fees: Record<string, number>;
}

/**
 * Billed fees for a window. Returns immediately: either the finished month, or
 * `ready: false, status: "scanning"` while the gateway walks Amazon's event
 * stream in the background. Ask again in a minute or two for the result -
 * waiting on the call is not an option, since Node's fetch cuts any response
 * off at five minutes and a month takes longer than that to page.
 */
export async function fetchBilledFees(gw: Gateway, start: string, end: string): Promise<BilledFees> {
  const out = (await gw(
    `/finances/service-fees?posted_after=${encodeURIComponent(start)}&posted_before=${encodeURIComponent(end)}`,
  )) as BilledFees;
  // A "scanning" reply carries no totals yet; fill the shapes the UI maps over
  // so it renders an empty month rather than throwing.
  return {
    ...out,
    total: out.total ?? 0,
    pages: out.pages ?? 0,
    by_group: out.by_group ?? {},
    by_type: out.by_type ?? [],
    charges: out.charges ?? [],
    unrecognised_fee_types: out.unrecognised_fee_types ?? [],
  };
}

// ── AWD stock ──────────────────────────────────────────────────────────────

export interface AwdStockRow {
  sku: string;
  available: number;
  inbound: number;
  reserved: number;
  toFba: number;
}

/** What sits at AWD right now. A live figure: the AWD API keeps no history. */
export async function fetchAwdStock(gw: Gateway): Promise<AwdStockRow[]> {
  try {
    const j = await gw(`/awd/inventory`);
    return (j.rows ?? []) as AwdStockRow[];
  } catch {
    // AWD being unreachable costs the allocation, not the whole report.
    return [];
  }
}

// ── inventory planning ─────────────────────────────────────────────────────

export interface PlanningRow {
  sku: string;
  asin?: string;
  sell_through: number | null;
  days_of_supply: number | null;
  item_volume_cuft: number | null;
  units_shipped_t90: number | null;
  storage_volume?: number | null;
  /** Amazon's own forecast of this SKU's storage cost next month. */
  estimated_storage_cost_next_month?: number | null;
  ais_monthly?: number;
  ais_units?: number;
}

export async function fetchPlanning(gw: Gateway, reportId: string): Promise<{ ready: boolean; rows: PlanningRow[] }> {
  const out = await gw(`/reports/${encodeURIComponent(reportId)}/planning`);
  return { ready: Boolean(out.ready), rows: (out.rows ?? []) as PlanningRow[] };
}

export async function requestPlanningReport(gw: Gateway): Promise<string | null> {
  const out = await gw(`/reports/?report_type=GET_FBA_INVENTORY_PLANNING_DATA`, { method: "POST" });
  return (out.reportId as string) ?? null;
}

export async function findDonePlanningReport(gw: Gateway): Promise<string | null> {
  const list = (await gw(`/reports/?report_type=GET_FBA_INVENTORY_PLANNING_DATA`)) as Array<{
    reportId: string;
    processingStatus?: string;
  }>;
  const done = (Array.isArray(list) ? list : []).filter((r) => r.processingStatus === "DONE");
  return done.length > 0 ? done[0].reportId : null;
}
