// Returnless-vs-return-required decision per SKU. Uses your real returns data
// from GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA plus the price from the
// unfulfillable/fees report to compute expected cost under each strategy.

import { getSellerCentralConfig } from "./env";
import { modelFeeExposure, type FeeExposure } from "./returnsProcessingFee";

const RESULT_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();
const lastKnown = new Map<string, string>();

function readCache<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RESULT_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}
function writeCache(key: string, value: unknown) {
  cache.set(key, { at: Date.now(), value });
}

function sca() {
  const cfg = getSellerCentralConfig();
  if (!cfg) throw new Error("Seller-central API not configured.");
  return cfg;
}
async function scaFetch(path: string, init?: RequestInit) {
  const cfg = sca();
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: { "X-API-Key": cfg.apiKey, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`seller-central-api ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export interface ReturnsSkuSummary {
  returnsTotal: number;
  returnlessTotal: number;
  physicalReturnTotal: number;
  sellableBack: number;
  customerDamaged: number;
  defective: number;
  expired: number;
  warehouseDamaged: number;
  carrierDamaged: number;
  distributorDamaged: number;
  unsellableTotal: number;
  topReason: string | null;
  lastReturnDate: string | null;
  /** SELLABLE / physical returns — the fraction of returned units that go
   *  back to fulfillable inventory. null if no physical returns yet. */
  sellableBackRate: number | null;
  physicalReturnOrderIds: string[];
}

export type ReturnsMap = Record<string, ReturnsSkuSummary>;

interface ReturnsDto {
  returns_total: number;
  returnless_total: number;
  physical_return_total: number;
  sellable_back: number;
  customer_damaged: number;
  defective: number;
  expired: number;
  warehouse_damaged: number;
  carrier_damaged: number;
  distributor_damaged: number;
  unsellable_total: number;
  top_reason: string | null;
  last_return_date?: string | null;
  sellable_back_rate: number | null;
  physical_return_order_ids?: string[];
}

export interface RefundsSkuSummary {
  refundLineCount: number;
  refundedQty: number;
  refundAmountTotal: number;
  orderIds: string[];
}

interface RefundsDto {
  refund_line_count: number;
  refunded_qty: number;
  refund_amount_total: number;
  order_ids: string[];
}

export type RefundsMap = Record<string, RefundsSkuSummary>;

export interface RefundsFetchResult {
  ready: boolean;
  status: string;
  reportId: string | null;
  skus: RefundsMap;
}

/**
 * Fetch customer-refund events per SKU from Finances API (money-truth). The
 * previous All-Orders-report source only captured full-line refunds and
 * missed most returnless (partial-refund) events; Finances captures every
 * refund transaction with SellerSKU + amount.
 *
 * NOTE: Finances API is paginated at ~0.5 req/s. On high-volume catalogs the
 * first 365-day fetch can take 5–15 min; we cache the result for 24h so
 * subsequent reloads are instant.
 */
// Refunds cache — 24h TTL because the Finances-API pagination behind this
// takes 5–15 min on first call (Amazon 0.5 req/s cap). One slow fetch a day,
// instant reloads for the rest.
const REFUNDS_TTL_MS = 24 * 60 * 60 * 1000;
const refundsCacheLong = new Map<string, { at: number; value: RefundsFetchResult }>();

export async function fetchRefundsBySku(): Promise<RefundsFetchResult> {
  const hit = refundsCacheLong.get("refunds");
  if (hit && Date.now() - hit.at < REFUNDS_TTL_MS && hit.value.ready) return hit.value;
  try {
    const out = (await scaFetch(`/finances/customer-refunds-by-sku?lookback_days=365`)) as {
      ready: boolean;
      status?: string;
      pages_fetched?: number;
      sku_count?: number;
      skus?: Record<string, RefundsDto>;
    };
    if (!out.ready || !out.skus) {
      return { ready: false, status: out.status ?? "pending", reportId: null, skus: {} };
    }
    const skus: RefundsMap = {};
    for (const [sku, d] of Object.entries(out.skus)) {
      skus[sku] = {
        refundLineCount: d.refund_line_count,
        refundedQty: d.refunded_qty,
        refundAmountTotal: d.refund_amount_total,
        orderIds: d.order_ids ?? [],
      };
    }
    const result: RefundsFetchResult = {
      ready: true,
      status: `DONE (${out.pages_fetched ?? "?"} pages, ${out.sku_count ?? Object.keys(skus).length} SKUs)`,
      reportId: null,
      skus,
    };
    refundsCacheLong.set("refunds", { at: Date.now(), value: result });
    return result;
  } catch (err) {
    // If we have any stale cache (even expired), surface it so the UI doesn't
    // regress to zero on a transient Amazon throttle.
    if (hit) return hit.value;
    return {
      ready: false,
      status: err instanceof Error ? err.message : "refunds fetch failed",
      reportId: null,
      skus: {},
    };
  }
}

const MIN_WINDOW_DAYS_TO_REUSE = 300;

/**
 * Find the newest DONE report whose window is wide enough for our year-over-
 * year view. Ignores 1-day defaults Amazon generates when no dataStartTime is
 * passed — those are useless for annualisation.
 */
async function findLatestDoneWideReport(reportTypeKey: string): Promise<string | null> {
  try {
    const list = (await scaFetch(`/reports/?report_type=${reportTypeKey}`)) as {
      reportId: string;
      processingStatus?: string;
      createdTime?: string;
      dataStartTime?: string;
      dataEndTime?: string;
    }[];
    const done = (Array.isArray(list) ? list : []).filter((r) => r.processingStatus === "DONE");
    if (done.length === 0) return null;
    done.sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? ""));
    for (const r of done) {
      const ds = r.dataStartTime;
      const de = r.dataEndTime;
      if (!ds || !de) continue;
      const spanDays = (new Date(de).getTime() - new Date(ds).getTime()) / 86_400_000;
      if (spanDays >= MIN_WINDOW_DAYS_TO_REUSE) return r.reportId;
    }
    return null;
  } catch {
    return lastKnown.get(reportTypeKey) ?? null;
  }
}

export interface ReturnsFetchResult {
  ready: boolean;
  status: string;
  reportId: string | null;
  skus: ReturnsMap;
}

export async function fetchReturnsSummary(): Promise<ReturnsFetchResult> {
  const cached = readCache<ReturnsFetchResult>("returns");
  if (cached && cached.ready) return cached;
  try {
    const inner = await _inner();
    if (inner.ready) writeCache("returns", inner);
    else if (cached) return cached;
    return inner;
  } catch (err) {
    if (cached) return cached;
    return {
      ready: false,
      status: err instanceof Error ? err.message : "returns fetch failed",
      reportId: null,
      skus: {},
    };
  }
}

// Rolling one-year window — the Returns Strategy view is a low-frequency,
// annualised decision so year-over-year signal beats a short window's noise.
const RETURNS_WINDOW_DAYS = 365;

async function _inner(): Promise<ReturnsFetchResult> {
  let reportId = await findLatestDoneWideReport("fba_returns");
  if (!reportId) {
    const start = new Date(Date.now() - RETURNS_WINDOW_DAYS * 86_400_000).toISOString();
    const created = await scaFetch(
      `/reports/?report_type=fba_returns&data_start_time=${encodeURIComponent(start)}`,
      { method: "POST" },
    );
    if (!created.reportId) {
      return { ready: false, status: created.error ?? "create failed", reportId: null, skus: {} };
    }
    reportId = created.reportId as string;
    lastKnown.set("fba_returns", reportId);
  }
  const out = (await scaFetch(`/reports/${encodeURIComponent(reportId)}/returns-summary`)) as {
    ready: boolean;
    status?: string;
    skus?: Record<string, ReturnsDto>;
  };
  if (!out.ready || !out.skus) {
    return { ready: false, status: out.status ?? "pending", reportId, skus: {} };
  }
  lastKnown.set("fba_returns", reportId);
  const skus: ReturnsMap = {};
  for (const [sku, d] of Object.entries(out.skus)) {
    skus[sku] = {
      returnsTotal: d.returns_total,
      returnlessTotal: d.returnless_total,
      physicalReturnTotal: d.physical_return_total,
      sellableBack: d.sellable_back,
      customerDamaged: d.customer_damaged,
      defective: d.defective,
      expired: d.expired,
      warehouseDamaged: d.warehouse_damaged,
      carrierDamaged: d.carrier_damaged,
      distributorDamaged: d.distributor_damaged,
      unsellableTotal: d.unsellable_total,
      topReason: d.top_reason,
      lastReturnDate: d.last_return_date ?? null,
      sellableBackRate: d.sellable_back_rate,
      physicalReturnOrderIds: d.physical_return_order_ids ?? [],
    };
  }
  return { ready: true, status: out.status ?? "DONE", reportId, skus };
}

// ── Decision math ────────────────────────────────────────────────────────────

/**
 * Estimate Amazon's return-shipping charge from item price. Amazon covers
 * return shipping upfront then bills sellers. Costs scale roughly with size,
 * and size correlates loosely with price for physical goods.
 */
export function estimateReturnShipping(price: number): number {
  if (price < 10) return 4.5;
  if (price < 20) return 5.5;
  if (price < 40) return 7.0;
  if (price < 75) return 9.0;
  return 12.0;
}

/** Grading + processing fee Amazon charges per physical return. */
export const PROCESSING_FEE = 2.0;

/**
 * Recovery rate on returned-unsellable units. Customer-damaged toys usually
 * still work; defective/expired don't. Weighted by the returns disposition mix
 * for a specific SKU (fallback: category average).
 */
export function estimateUnsellableRecoveryRate(r: ReturnsSkuSummary): number {
  const u = r.unsellableTotal;
  if (u <= 0) return 0.1;
  // Customer-damaged: ~30% recovery via Grade & Resell / Liquidation.
  // Warehouse/carrier/distributor damage: 100% reimbursement.
  // Defective/expired: ~0.
  const weighted =
    (r.customerDamaged * 0.3 +
      (r.warehouseDamaged + r.carrierDamaged + r.distributorDamaged) * 1.0 +
      r.defective * 0 +
      r.expired * 0) /
    u;
  return weighted;
}

export type CurrentStatus =
  | "returnless_dominant"    // ≥ 60% of refunds are returnless
  | "physical_dominant"      // ≥ 60% are physical returns
  | "mixed_policy"           // 40-60% either way — Amazon splits per-return
  | "no_returns";

export interface StrategyResult {
  sku: string;
  price: number;
  windowDays: number;
  /** Refunds in the report window (365 days). */
  returnsCount: number;
  physicalReturnCount: number;
  returnlessCount: number;
  /** Percentage of refunds that used returnless (0–100). */
  returnlessSharePct: number;
  /** Effective per-SKU status inferred from actual mix. */
  currentStatus: CurrentStatus;
  currentStatusLabel: string;
  /** Amazon's judged SELLABLE-on-physical-return rate for THIS SKU. */
  sellableBackRate: number;
  // ── Per-return economics
  returnlessCostPerReturn: number;
  returnRequiredCostPerReturn: number;
  savingsPerReturn: number;
  // ── Actual (mixed) vs pure hypothetical annual costs
  /** Actual annual cost you paid at current returnless/physical mix. */
  currentAnnualCost: number;
  /** Hypothetical annual cost if EVERY refund used returnless. */
  ifAllReturnlessAnnualCost: number;
  /** Hypothetical annual cost if EVERY refund forced a physical return. */
  ifAllPhysicalAnnualCost: number;
  /** Savings if you switched every returnless → physical (positive = win). */
  annualDelta: number;
  /** Returns-processing-fee exposure now vs. if switched (null when unknown). */
  feeExposure: FeeExposure | null;
  /** New returns-processing fee incurred by switching (already netted off delta). */
  extraFeeIfSwitched: number;
  /** Recommended action for this SKU. */
  verdict:
    | "switch_to_return_required"
    | "keep_returnless"
    | "marginal"
    | "insufficient_data";
  reason: string;
}

export interface FeeContext {
  /** Displayed return rate as a fraction (e.g. 0.0555). From dashboard paste. */
  displayedReturnRate: number;
  /** Category return-rate threshold as a fraction (e.g. 0.047). */
  threshold: number;
  /** Per-unit returns-processing fee from Amazon's 2026 rate card. */
  feePerUnit: number;
}

export interface StrategyOptions {
  feeContext?: FeeContext;
  windowDays?: number;
}

export function computeStrategy(
  sku: string,
  summary: ReturnsSkuSummary,
  price: number,
  refunds?: RefundsSkuSummary,
  opts?: StrategyOptions,
): StrategyResult {
  const windowDays = opts?.windowDays ?? 365;
  const returnShip = estimateReturnShipping(price);
  const sellableRate = summary.sellableBackRate ?? 0.4;
  const feeCtx = opts?.feeContext;

  // Derive returnless count = total refunded orders − physical-return orders.
  // Use set difference on order-ids for accuracy when both data sources are
  // present; otherwise fall back to the returns-report's own returnless_total.
  let returnlessCount = summary.returnlessTotal;
  let physicalCount = summary.physicalReturnTotal;
  let totalReturns = summary.returnsTotal;
  if (refunds) {
    const physicalOrders = new Set(summary.physicalReturnOrderIds ?? []);
    const returnlessOrders = refunds.orderIds.filter((oid) => !physicalOrders.has(oid));
    returnlessCount = returnlessOrders.length;
    physicalCount = physicalOrders.size;
    totalReturns = returnlessCount + physicalCount;
  }

  // ── Per-refund economics ─────────────────────────────────────────────────
  // The refund to the customer is paid in BOTH scenarios. Returnless simply
  // means you never get the unit back. (An earlier version omitted the refund
  // from the physical-return side, which overstated savings roughly 3x.)
  const unsellableRate = 1 - sellableRate;
  const unsellableRecoveryRate = estimateUnsellableRecoveryRate(summary);

  const returnlessCostPerReturn = price; // refund out, nothing recovered

  const recoveredValue =
    price * sellableRate + price * unsellableRate * unsellableRecoveryRate;
  const returnRequiredCostPerReturn =
    price + returnShip + PROCESSING_FEE - recoveredValue;

  const savingsPerReturn = returnlessCostPerReturn - returnRequiredCostPerReturn;

  // Annualize to a full year regardless of the window used.
  const yearScale = 365 / windowDays;

  // ── Returns-processing-fee exposure ──────────────────────────────────────
  // Returnless refunds are EXEMPT from Amazon's returns-processing fee, and
  // only units above the category threshold are charged. So converting
  // returnless → physical can create new fee exposure that partly offsets the
  // per-refund savings.
  let feeExposure: FeeExposure | null = null;
  let extraFeeIfSwitched = 0;
  if (feeCtx && feeCtx.displayedReturnRate > 0 && totalReturns > 0) {
    feeExposure = modelFeeExposure({
      totalRefunds: totalReturns,
      physicalRefunds: physicalCount,
      displayedReturnRate: feeCtx.displayedReturnRate,
      threshold: feeCtx.threshold,
      feePerUnit: feeCtx.feePerUnit,
    });
    extraFeeIfSwitched = feeExposure.additionalFeeIfSwitched * yearScale;
  }

  // Actual current-mix annual cost, plus both pure-strategy hypotheticals.
  const currentAnnualCost =
    (returnlessCount * returnlessCostPerReturn + physicalCount * returnRequiredCostPerReturn) *
      yearScale +
    (feeExposure?.annualFeeNow ?? 0) * yearScale;
  const ifAllReturnlessAnnualCost = totalReturns * returnlessCostPerReturn * yearScale;
  const ifAllPhysicalAnnualCost =
    totalReturns * returnRequiredCostPerReturn * yearScale +
    (feeExposure?.annualFeeIfAllPhysical ?? 0) * yearScale;

  // Delta = per-refund savings on the converted units, MINUS the new
  // returns-processing fee that switching exposes.
  const annualDelta = savingsPerReturn * returnlessCount * yearScale - extraFeeIfSwitched;

  // Current-status label from the mix.
  let currentStatus: CurrentStatus;
  const share = totalReturns > 0 ? returnlessCount / totalReturns : 0;
  if (totalReturns === 0) currentStatus = "no_returns";
  else if (share >= 0.6) currentStatus = "returnless_dominant";
  else if (share <= 0.4) currentStatus = "physical_dominant";
  else currentStatus = "mixed_policy";

  const currentStatusLabel = ({
    returnless_dominant: `Returnless-dominant (${(share * 100).toFixed(0)}% returnless)`,
    physical_dominant: `Physical returns (${((1 - share) * 100).toFixed(0)}% physical)`,
    mixed_policy: `Mixed policy (${(share * 100).toFixed(0)}% returnless)`,
    no_returns: "No returns yet",
  } as const)[currentStatus];

  // Amazon's own hard ceiling for returnless-eligibility per their docs.
  const AMAZON_RETURNLESS_CEILING = 75;

  let verdict: StrategyResult["verdict"];
  let reason: string;
  if (totalReturns < 3) {
    verdict = "insufficient_data";
    reason = `Fewer than 3 refunds in ${windowDays} days — not enough signal.`;
  } else if (returnlessCount === 0 && price > AMAZON_RETURNLESS_CEILING) {
    verdict = "keep_returnless";
    reason = `Price $${price.toFixed(2)} > Amazon's $75 returnless ceiling — Amazon already forces 100% physical. Nothing to change.`;
  } else if (returnlessCount === 0) {
    verdict = "keep_returnless";
    reason = "Already 100% return-required for this SKU — enrollment setting isn't producing any returnless refunds.";
  } else if (annualDelta > 0 && savingsPerReturn > 2) {
    verdict = "switch_to_return_required";
    const feeNote =
      extraFeeIfSwitched > 0
        ? ` Nets out $${extraFeeIfSwitched.toFixed(0)}/yr of new returns-processing fee (returnless is exempt from it).`
        : "";
    reason = `Recovers $${savingsPerReturn.toFixed(2)} per returnless refund (unit comes back; ${(sellableRate * 100).toFixed(0)}% resellable). Switching all ${returnlessCount} → +$${annualDelta.toFixed(0)}/yr.${feeNote}`;
  } else if (annualDelta <= 0 && extraFeeIfSwitched > 0) {
    verdict = "keep_returnless";
    reason = `Switching would add $${extraFeeIfSwitched.toFixed(0)}/yr in returns-processing fees (returnless is exempt) — more than the $${(savingsPerReturn * returnlessCount).toFixed(0)} recovered. Keep returnless.`;
  } else if (savingsPerReturn < -1) {
    verdict = "keep_returnless";
    reason = `Return-required would cost ~$${Math.abs(savingsPerReturn).toFixed(2)} more per return (shipping > recoverable value at this price).`;
  } else {
    verdict = "marginal";
    reason = `Within ~$5/refund either way. Keep current setting.`;
  }

  return {
    sku,
    price,
    windowDays,
    returnsCount: totalReturns,
    physicalReturnCount: physicalCount,
    returnlessCount,
    returnlessSharePct: share * 100,
    currentStatus,
    currentStatusLabel,
    sellableBackRate: sellableRate,
    returnlessCostPerReturn,
    returnRequiredCostPerReturn,
    savingsPerReturn,
    currentAnnualCost,
    ifAllReturnlessAnnualCost,
    ifAllPhysicalAnnualCost,
    annualDelta,
    feeExposure,
    extraFeeIfSwitched: Math.round(extraFeeIfSwitched * 100) / 100,
    verdict,
    reason,
  };
}
